// biome-ignore-all lint/style/useNamingConvention: nats.js spells its settings in snake case
import { defineCommand, defineContract, defineEvent, defineGroup } from '@cf-loom/contract';
import { handle, readersOf } from '@cf-loom/handlers';
import { JetStreamApiError, jetstream as jetStreamClientOf } from '@nats-io/jetstream';
import type { NatsConnection } from '@nats-io/nats-core';
import { connect } from '@nats-io/transport-node';
import { afterAll, beforeAll, describe, expect, onTestFinished, test } from 'vitest';
import { z } from 'zod';
import { withMethods } from '../../test/connections.ts';
import { arrangeDurable, durableConfigOf, durableInfoOf } from '../../test/durables.ts';
import { aNatsServer, type NatsServer } from '../../test/nats-server.ts';
import { arrangeStream, planOf, streamConfigOf, streamInfoOf } from '../../test/streams.ts';
import { messaging } from '../index.ts';
import { type BrokerLimits, type BrokerPlan, jetstream } from './index.ts';

const nanosPerSecond = 1_000_000_000;

const orderBody = z.object({ orderId: z.string() });

const orderCreatedV1 = defineEvent({
  name: 'OrderCreated',
  version: 1,
  visibility: 'internal',
  description: 'An order was created',
  body: orderBody,
});

const chargeCardV1 = defineCommand({
  name: 'ChargeCard',
  version: 1,
  description: 'Charges the order’s card',
  body: orderBody,
});

const contract = defineContract({
  name: 'orders-service',
  groups: [
    defineGroup({
      name: 'messages',
      description: 'Messages',
      events: [orderCreatedV1],
      commands: [chargeCardV1],
    }),
  ],
});

let server: NatsServer;
let tests = 0;

beforeAll(async () => {
  server = await aNatsServer();
});

afterAll(async () => {
  await server.stop();
});

/** A prefix no other test of this file uses, so streams on the shared server never collide. */
function aPrefix(): string {
  tests += 1;
  return `t-${tests}`;
}

/** The Service’s `connect`: opens a connection to the test server, keeps it and closes it when the test ends. */
function aConnect() {
  const opened: NatsConnection[] = [];
  const connectService = async (): Promise<NatsConnection> => {
    const connection = await connect({ servers: server.url });
    opened.push(connection);
    onTestFinished(() => connection.close());
    return connection;
  };
  return { connect: connectService, opened };
}

/** Every setting a stream and a durable consumer needs, as the files the arranged ones are made with. */
const testLimits: BrokerLimits = {
  streamDefaults: {
    retention: 'limits',
    maxAge: '7d',
    duplicateWindow: '2m',
    replicas: 1,
    storage: 'file',
  },
  consumerDefaults: { deliverPolicy: 'all', ackWait: '30s', maxDeliver: 5, maxAckPending: 100 },
};

/** The names and subjects of Orders’ plan under a prefix, and the plan itself. */
function anOrders(prefix: string) {
  const stream = `${prefix}_orders-service`;
  const created = `${prefix}.orders-service.event.OrderCreated.v1`;
  const charge = `${prefix}.orders-service.command.ChargeCard.v1`;
  const chargeDurable = `${prefix}_orders-service_command_ChargeCard_v1`;
  const plan: BrokerPlan = {
    prefix,
    streams: { [stream]: { service: 'orders-service', subjects: [charge, created] } },
    consumers: {
      [chargeDurable]: { service: 'orders-service', stream, subject: charge },
    },
  };
  return { stream, created, charge, chargeDurable, plan };
}

type Orders = ReturnType<typeof anOrders>;

/** Billing’s plan under a prefix: no stream, and one durable consumer on Orders’ stream. */
function aBilling(prefix: string) {
  const orders = anOrders(prefix);
  const durable = `${prefix}_billing-service_draft-invoice-on-created`;
  const plan: BrokerPlan = {
    prefix,
    streams: {},
    consumers: {
      [durable]: { service: 'billing-service', stream: orders.stream, subject: orders.created },
    },
  };
  return { durable, plan, orders };
}

/** Limits as a Service reads them from a JSON file, so a test can write a value the types refuse. */
function readFromJson(limits: unknown): BrokerLimits {
  return JSON.parse(JSON.stringify(limits));
}

/** Orders’ stream, holding its subjects, as the organization’s tooling would arrange it. */
function arrangeOrdersStream(orders: Orders): Promise<void> {
  return arrangeStream(server.url, {
    name: orders.stream,
    subjects: [orders.charge, orders.created],
  });
}

/** The Handlers `consume` needs for Orders’ plan: one for its Command, which does nothing. */
function chargeHandlers() {
  const readers = readersOf({
    commands: { chargeCardV1: { element: chargeCardV1, reader: orderBody } },
    subscriptions: {},
  });
  return {
    commands: { chargeCardV1: handle(readers.commands.chargeCardV1, async () => undefined) },
    subscriptions: {},
    readers,
  };
}

async function rejectionOf(applying: Promise<void>): Promise<Error> {
  try {
    await applying;
  } catch (error) {
    if (error instanceof Error) {
      return error;
    }
    throw error;
  }
  throw new Error('apply did not reject');
}

describe('applying a broker plan with jetstream()', () => {
  test('apply creates each stream of the plan with its subjects, retention, max age, duplicate window, replicas and storage', async () => {
    const prefix = aPrefix();
    const orders = anOrders(prefix);
    const broker = jetstream({ connect: aConnect().connect, prefix });
    const limits: BrokerLimits = {
      streamDefaults: {
        retention: 'interest',
        maxAge: '1h',
        duplicateWindow: '90s',
        replicas: 1,
        storage: 'memory',
      },
      consumerDefaults: testLimits.consumerDefaults,
    };

    await broker.apply(orders.plan, limits);

    const config = await streamConfigOf(server.url, orders.stream);
    expect(config).toMatchObject({
      name: orders.stream,
      retention: 'interest',
      max_age: 3600 * nanosPerSecond,
      duplicate_window: 90 * nanosPerSecond,
      num_replicas: 1,
      storage: 'memory',
    });
    expect([...config.subjects].sort()).toEqual([orders.charge, orders.created].sort());
  });

  test('apply creates each durable consumer as a pull consumer with explicit acknowledgements, filtered on the plan’s subject', async () => {
    const prefix = aPrefix();
    const orders = anOrders(prefix);
    const broker = jetstream({ connect: aConnect().connect, prefix });
    const limits: BrokerLimits = {
      ...testLimits,
      consumerDefaults: { deliverPolicy: 'new', ackWait: '45s', maxDeliver: 7, maxAckPending: 20 },
    };

    await broker.apply(orders.plan, limits);

    const config = await durableConfigOf(server.url, orders.stream, orders.chargeDurable);
    expect(config).toMatchObject({
      durable_name: orders.chargeDurable,
      ack_policy: 'explicit',
      filter_subject: orders.charge,
      deliver_policy: 'new',
      ack_wait: 45 * nanosPerSecond,
      max_deliver: 7,
      max_ack_pending: 20,
    });
    expect(config.deliver_subject).toBeUndefined();
  });

  test('a stream’s or durable consumer’s own limits override the defaults setting by setting', async () => {
    const prefix = aPrefix();
    const orders = anOrders(prefix);
    const broker = jetstream({ connect: aConnect().connect, prefix });
    const limits: BrokerLimits = {
      ...testLimits,
      streams: { [orders.stream]: { maxAge: '2h' } },
      consumers: { [orders.chargeDurable]: { ackWait: '2m', maxDeliver: 9 } },
    };

    await broker.apply(orders.plan, limits);

    const stream = await streamConfigOf(server.url, orders.stream);
    const durable = await durableConfigOf(server.url, orders.stream, orders.chargeDurable);
    expect(stream).toMatchObject({
      max_age: 7200 * nanosPerSecond,
      duplicate_window: 120 * nanosPerSecond,
    });
    expect(durable).toMatchObject({
      ack_wait: 120 * nanosPerSecond,
      max_deliver: 9,
      max_ack_pending: 100,
    });
  });

  test('apply adds the plan’s subjects to an existing stream and keeps the subjects it already held', async () => {
    const prefix = aPrefix();
    const orders = anOrders(prefix);
    const other = `${prefix}.orders-service.other`;
    await arrangeStream(server.url, { name: orders.stream, subjects: [other, orders.created] });
    const broker = jetstream({ connect: aConnect().connect, prefix });

    await broker.apply(orders.plan, testLimits);

    const { subjects } = await streamConfigOf(server.url, orders.stream);
    expect([...subjects].sort()).toEqual([other, orders.charge, orders.created].sort());
  });

  test('apply adds no subject to a stream that already holds it through a wildcard', async () => {
    const prefix = aPrefix();
    const orders = anOrders(prefix);
    const wildcard = `${prefix}.orders-service.>`;
    await arrangeStream(server.url, { name: orders.stream, subjects: [wildcard] });
    const broker = jetstream({ connect: aConnect().connect, prefix });

    await broker.apply(orders.plan, testLimits);

    const { subjects } = await streamConfigOf(server.url, orders.stream);
    expect(subjects).toEqual([wildcard]);
  });

  test('apply updates the limits of an existing stream and durable consumer that NATS lets change and keeps the settings limits does not name', async () => {
    const prefix = aPrefix();
    const orders = anOrders(prefix);
    await arrangeStream(
      server.url,
      { name: orders.stream, subjects: [orders.charge, orders.created] },
      {
        max_bytes: 1_000_000,
        max_age: 86_400 * nanosPerSecond,
        duplicate_window: 60 * nanosPerSecond,
        retention: 'limits',
      },
    );
    await arrangeDurable(server.url, orders.stream, {
      durable_name: orders.chargeDurable,
      filter_subject: orders.charge,
      ack_policy: 'explicit',
      ack_wait: 10 * nanosPerSecond,
      max_deliver: 3,
      max_ack_pending: 7,
      description: 'arranged by hand',
    });
    const broker = jetstream({ connect: aConnect().connect, prefix });
    const limits: BrokerLimits = {
      ...testLimits,
      streams: { [orders.stream]: { retention: 'interest' } },
    };

    await broker.apply(orders.plan, limits);

    const stream = await streamConfigOf(server.url, orders.stream);
    const durable = await durableConfigOf(server.url, orders.stream, orders.chargeDurable);
    expect(stream).toMatchObject({
      retention: 'interest',
      max_age: 604_800 * nanosPerSecond,
      duplicate_window: 120 * nanosPerSecond,
      num_replicas: 1,
      storage: 'file',
      max_bytes: 1_000_000,
    });
    expect(durable).toMatchObject({
      deliver_policy: 'all',
      ack_wait: 30 * nanosPerSecond,
      max_deliver: 5,
      max_ack_pending: 100,
      description: 'arranged by hand',
    });
  });

  test('applying the same plan twice leaves the streams, durable consumers and stored Messages as the first apply left them', async () => {
    const prefix = aPrefix();
    const orders = anOrders(prefix);
    const service = aConnect();
    const broker = jetstream({ connect: service.connect, prefix });
    await broker.apply(orders.plan, testLimits);
    const connection = await service.connect();
    await jetStreamClientOf(connection).publish(orders.created, '{}');
    const first = await streamInfoOf(server.url, orders.stream);
    const firstDurable = await durableConfigOf(server.url, orders.stream, orders.chargeDurable);

    await broker.apply(orders.plan, testLimits);

    const again = await streamInfoOf(server.url, orders.stream);
    const againDurable = await durableConfigOf(server.url, orders.stream, orders.chargeDurable);
    expect(again.config).toEqual(first.config);
    expect(again.state.messages).toBe(first.state.messages);
    expect(first.state.messages).toBe(1);
    expect(againDurable).toEqual(firstDurable);
  });

  test('apply creates a durable consumer on a stream the same plan creates', async () => {
    const prefix = aPrefix();
    const orders = anOrders(prefix);
    const broker = jetstream({ connect: aConnect().connect, prefix });

    await broker.apply(orders.plan, testLimits);

    const info = await durableInfoOf(server.url, orders.stream, orders.chargeDurable);
    expect(info?.stream_name).toBe(orders.stream);
  });

  test('a plan with no stream creates only its durable consumers, on its Provider’s existing stream', async () => {
    const prefix = aPrefix();
    const billing = aBilling(prefix);
    await jetstream({ connect: aConnect().connect, prefix }).apply(billing.orders.plan, testLimits);
    const broker = jetstream({ connect: aConnect().connect, prefix });

    await broker.apply(billing.plan, testLimits);

    const info = await durableInfoOf(server.url, billing.orders.stream, billing.durable);
    expect(info?.config.filter_subject).toBe(billing.orders.created);
  });

  test('apply never removes a subject, stream or durable consumer that the plan it applies does not list', async () => {
    const prefix = aPrefix();
    const orders = anOrders(prefix);
    const leftover = `${prefix}.orders-service.event.OrderCancelled.v1`;
    const leftoverDurable = `${prefix}_orders-service_notify-on-cancelled`;
    await arrangeStream(server.url, { name: orders.stream, subjects: [leftover] });
    await arrangeStream(server.url, {
      name: `${prefix}_retired-service`,
      subjects: [`${prefix}.r`],
    });
    await arrangeDurable(server.url, orders.stream, {
      durable_name: leftoverDurable,
      filter_subject: leftover,
      ack_policy: 'explicit',
    });
    const broker = jetstream({ connect: aConnect().connect, prefix });

    await broker.apply(orders.plan, testLimits);

    const { subjects } = await streamConfigOf(server.url, orders.stream);
    expect(subjects).toContain(leftover);
    await expect(streamConfigOf(server.url, `${prefix}_retired-service`)).resolves.toBeDefined();
    await expect(
      durableConfigOf(server.url, orders.stream, leftoverDurable),
    ).resolves.toBeDefined();
  });

  test('without a prefix, apply creates the names and subjects the plan prints, unprefixed', async () => {
    const plan: BrokerPlan = {
      prefix: null,
      streams: {
        'unprefixed-orders': {
          service: 'unprefixed-orders',
          subjects: ['unprefixed-orders.event.A.v1'],
        },
      },
      consumers: {
        'unprefixed-orders_command_B_v1': {
          service: 'unprefixed-orders',
          stream: 'unprefixed-orders',
          subject: 'unprefixed-orders.event.A.v1',
        },
      },
    };
    const broker = jetstream({ connect: aConnect().connect });

    await broker.apply(plan, testLimits);

    const stream = await streamConfigOf(server.url, 'unprefixed-orders');
    const durable = await durableConfigOf(
      server.url,
      'unprefixed-orders',
      'unprefixed-orders_command_B_v1',
    );
    expect(stream.subjects).toEqual(['unprefixed-orders.event.A.v1']);
    expect(durable.filter_subject).toBe('unprefixed-orders.event.A.v1');
  });

  test('"unlimited" reaches NATS as no limit: max age 0, max deliver -1 and max ack pending -1', async () => {
    const prefix = aPrefix();
    const orders = anOrders(prefix);
    const broker = jetstream({ connect: aConnect().connect, prefix });
    const limits: BrokerLimits = {
      streamDefaults: { ...testLimits.streamDefaults, maxAge: 'unlimited' },
      consumerDefaults: {
        ...testLimits.consumerDefaults,
        maxDeliver: 'unlimited',
        maxAckPending: 'unlimited',
      },
    };

    await broker.apply(orders.plan, limits);

    const stream = await streamConfigOf(server.url, orders.stream);
    const durable = await durableConfigOf(server.url, orders.stream, orders.chargeDurable);
    expect(stream.max_age).toBe(0);
    expect(durable).toMatchObject({ max_deliver: -1, max_ack_pending: -1 });
  });

  test('a duration of a year reaches NATS exactly, in nanoseconds', async () => {
    const prefix = aPrefix();
    const orders = anOrders(prefix);
    const broker = jetstream({ connect: aConnect().connect, prefix });
    const limits: BrokerLimits = {
      ...testLimits,
      streamDefaults: { ...testLimits.streamDefaults, maxAge: '365d' },
    };

    await broker.apply(orders.plan, limits);

    const stream = await streamConfigOf(server.url, orders.stream);
    expect(stream.max_age).toBe(31_536_000_000_000_000);
  });

  test('the longest duration NATS holds in 64 bits reaches it exactly, in nanoseconds', async () => {
    const prefix = aPrefix();
    const orders = anOrders(prefix);
    const broker = jetstream({ connect: aConnect().connect, prefix });
    const limits: BrokerLimits = {
      ...testLimits,
      streamDefaults: { ...testLimits.streamDefaults, maxAge: '106751d' },
    };

    await broker.apply(orders.plan, limits);

    const stream = await streamConfigOf(server.url, orders.stream);
    expect(stream.max_age).toBe(9_223_286_400_000_000_000);
  });

  test('an undefined setting in a stream’s or durable consumer’s own limits leaves the default in place', async () => {
    const prefix = aPrefix();
    const orders = anOrders(prefix);
    const broker = jetstream({ connect: aConnect().connect, prefix });
    const limits: BrokerLimits = {
      ...testLimits,
      streams: { [orders.stream]: { maxAge: undefined, replicas: undefined } },
      consumers: { [orders.chargeDurable]: { ackWait: undefined } },
    };

    await broker.apply(orders.plan, limits);

    const stream = await streamConfigOf(server.url, orders.stream);
    const durable = await durableConfigOf(server.url, orders.stream, orders.chargeDurable);
    expect(stream).toMatchObject({ max_age: 604_800 * nanosPerSecond, num_replicas: 1 });
    expect(durable.ack_wait).toBe(30 * nanosPerSecond);
  });

  test('an undefined entry for a stream, a durable consumer or a name the plan does not list leaves the defaults in place', async () => {
    const prefix = aPrefix();
    const orders = anOrders(prefix);
    const broker = jetstream({ connect: aConnect().connect, prefix });
    const limits: BrokerLimits = {
      ...testLimits,
      streams: { [orders.stream]: undefined, [`${prefix}_unlisted`]: undefined },
      consumers: { [orders.chargeDurable]: undefined, [`${prefix}_unlisted_durable`]: undefined },
    };

    await broker.apply(orders.plan, limits);

    const stream = await streamConfigOf(server.url, orders.stream);
    expect(stream.max_age).toBe(604_800 * nanosPerSecond);
  });

  test('a list of ack waits reaches NATS as its backoff, the first as the ack wait', async () => {
    const prefix = aPrefix();
    const orders = anOrders(prefix);
    const broker = jetstream({ connect: aConnect().connect, prefix });
    const limits: BrokerLimits = {
      ...testLimits,
      consumerDefaults: { ...testLimits.consumerDefaults, ackWait: ['30s', '1m', '5m'] },
    };

    await broker.apply(orders.plan, limits);

    const durable = await durableConfigOf(server.url, orders.stream, orders.chargeDurable);
    expect(durable.ack_wait).toBe(30 * nanosPerSecond);
    expect(durable.backoff).toEqual([
      30 * nanosPerSecond,
      60 * nanosPerSecond,
      300 * nanosPerSecond,
    ]);
  });

  test('an update that sets one ack wait clears the backoff the durable consumer had', async () => {
    const prefix = aPrefix();
    const orders = anOrders(prefix);
    const broker = jetstream({ connect: aConnect().connect, prefix });
    const withBackoff: BrokerLimits = {
      ...testLimits,
      consumerDefaults: { ...testLimits.consumerDefaults, ackWait: ['30s', '1m'] },
    };
    await broker.apply(orders.plan, withBackoff);

    await broker.apply(orders.plan, {
      ...testLimits,
      consumers: { [orders.chargeDurable]: { ackWait: '2m' } },
    });

    const durable = await durableConfigOf(server.url, orders.stream, orders.chargeDurable);
    expect(durable.ack_wait).toBe(120 * nanosPerSecond);
    expect(durable.backoff ?? []).toEqual([]);
  });
});

describe('applying a broker plan to a durable consumer cf-loom cannot pull from', () => {
  test('apply turns off headers only on an existing durable consumer', async () => {
    const prefix = aPrefix();
    const orders = anOrders(prefix);
    await arrangeOrdersStream(orders);
    await arrangeDurable(server.url, orders.stream, {
      durable_name: orders.chargeDurable,
      filter_subject: orders.charge,
      ack_policy: 'explicit',
      headers_only: true,
    });
    const broker = jetstream({ connect: aConnect().connect, prefix });

    await broker.apply(orders.plan, testLimits);

    const durable = await durableConfigOf(server.url, orders.stream, orders.chargeDurable);
    expect(durable.headers_only ?? false).toBe(false);
  });

  test('apply clears the priority groups, policy and timeout of an existing durable consumer', async () => {
    const prefix = aPrefix();
    const orders = anOrders(prefix);
    await arrangeOrdersStream(orders);
    await arrangeDurable(server.url, orders.stream, {
      durable_name: orders.chargeDurable,
      filter_subject: orders.charge,
      ack_policy: 'explicit',
      priority_groups: ['g'],
      priority_policy: 'pinned_client',
      priority_timeout: 120 * nanosPerSecond,
    });
    const broker = jetstream({ connect: aConnect().connect, prefix });

    await broker.apply(orders.plan, testLimits);

    const durable = await durableConfigOf(server.url, orders.stream, orders.chargeDurable);
    expect(durable.priority_groups ?? []).toEqual([]);
    expect(durable.priority_policy ?? 'none').toBe('none');
    expect(durable.priority_timeout ?? 0).toBe(0);
  });

  test.each([
    ['delivers headers only', () => ({ headers_only: true })],
    [
      'has priority groups pinned to a client',
      () => ({ priority_groups: ['g'], priority_policy: 'pinned_client' as const }),
    ],
    [
      'has priority groups with the overflow policy',
      () => ({ priority_groups: ['g', 'h'], priority_policy: 'overflow' as const }),
    ],
    ['is filtered on another subject', (orders: Orders) => ({ filter_subject: orders.created })],
  ])(
    'a durable consumer that %s is refused by consume until apply ran, and accepted after',
    async (_name, settings) => {
      const prefix = aPrefix();
      const orders = anOrders(prefix);
      await arrangeOrdersStream(orders);
      await arrangeDurable(server.url, orders.stream, {
        durable_name: orders.chargeDurable,
        filter_subject: orders.charge,
        ack_policy: 'explicit',
        ...settings(orders),
      });
      const broker = jetstream({ connect: aConnect().connect, prefix });
      const opened = await messaging(contract, broker);
      onTestFinished(() => opened.close());
      const handlers = chargeHandlers();
      await expect(opened.consume(handlers)).rejects.toThrow(
        `The durable consumer ${orders.chargeDurable} `,
      );

      await broker.apply(orders.plan, testLimits);

      await expect(opened.consume(handlers)).resolves.toBeUndefined();
    },
  );

  test('a durable consumer that does not acknowledge explicitly, which NATS does not change, rejects apply and is still refused by consume', async () => {
    const prefix = aPrefix();
    const orders = anOrders(prefix);
    await arrangeOrdersStream(orders);
    await arrangeDurable(server.url, orders.stream, {
      durable_name: orders.chargeDurable,
      filter_subject: orders.charge,
      ack_policy: 'none',
    });
    const broker = jetstream({ connect: aConnect().connect, prefix });
    const opened = await messaging(contract, broker);
    onTestFinished(() => opened.close());

    const error = await rejectionOf(broker.apply(orders.plan, testLimits));

    expect(error.message).toContain(
      `The durable consumer ${orders.chargeDurable} could not be applied: `,
    );
    await expect(opened.consume(chargeHandlers())).rejects.toThrow(
      `The durable consumer ${orders.chargeDurable} has the ack policy none, not explicit`,
    );
  });
});

describe('what applying a broker plan refuses', () => {
  test('apply refuses a durable consumer whose stream does not exist yet, naming the stream, and keeps the streams it created', async () => {
    const prefix = aPrefix();
    const billing = aBilling(prefix);
    const own = `${prefix}_billing-service`;
    const plan: BrokerPlan = {
      ...billing.plan,
      streams: {
        [own]: { service: 'billing-service', subjects: [`${prefix}.billing-service.event.X.v1`] },
      },
    };
    const broker = jetstream({ connect: aConnect().connect, prefix });

    const error = await rejectionOf(broker.apply(plan, testLimits));

    expect(error.message).toBe(
      `The durable consumer ${billing.durable} reads the stream ${billing.orders.stream}, which does not exist yet: apply its Service's plan first`,
    );
    await expect(streamConfigOf(server.url, own)).resolves.toBeDefined();
    await expect(durableInfoOf(server.url, own, billing.durable)).resolves.toBeUndefined();
  });

  test('applying again once the missing stream exists completes the plan', async () => {
    const prefix = aPrefix();
    const billing = aBilling(prefix);
    const broker = jetstream({ connect: aConnect().connect, prefix });
    await rejectionOf(broker.apply(billing.plan, testLimits));
    await broker.apply(billing.orders.plan, testLimits);

    await broker.apply(billing.plan, testLimits);

    const info = await durableInfoOf(server.url, billing.orders.stream, billing.durable);
    expect(info?.config.filter_subject).toBe(billing.orders.created);
  });

  test('apply stops at the first durable consumer it cannot apply and creates none after it', async () => {
    const prefix = aPrefix();
    const orders = anOrders(prefix);
    await jetstream({ connect: aConnect().connect, prefix }).apply(orders.plan, testLimits);
    const first = `${prefix}_billing-service_first`;
    const second = `${prefix}_billing-service_second`;
    const plan: BrokerPlan = {
      prefix,
      streams: {},
      consumers: {
        [first]: {
          service: 'billing-service',
          stream: `${prefix}_absent`,
          subject: orders.created,
        },
        [second]: { service: 'billing-service', stream: orders.stream, subject: orders.created },
      },
    };
    const broker = jetstream({ connect: aConnect().connect, prefix });

    const error = await rejectionOf(broker.apply(plan, testLimits));

    expect(error.message).toContain(
      `The durable consumer ${first} reads the stream ${prefix}_absent`,
    );
    await expect(durableInfoOf(server.url, orders.stream, second)).resolves.toBeUndefined();
  });

  test('a stream’s storage, which NATS does not change, rejects apply naming the stream, with NATS’s error as its cause', async () => {
    const prefix = aPrefix();
    const orders = anOrders(prefix);
    await arrangeStream(
      server.url,
      { name: orders.stream, subjects: [orders.charge, orders.created] },
      { storage: 'memory' },
    );
    const broker = jetstream({ connect: aConnect().connect, prefix });

    const error = await rejectionOf(broker.apply(orders.plan, testLimits));

    expect(error.message).toContain(`The stream ${orders.stream} could not be applied: `);
    expect(error.message).toContain('storage');
    expect(error.cause).toBeInstanceOf(JetStreamApiError);
  });

  test('more replicas than a single NATS server holds reject apply naming the stream, with NATS’s error as its cause', async () => {
    const prefix = aPrefix();
    const orders = anOrders(prefix);
    const broker = jetstream({ connect: aConnect().connect, prefix });
    const limits: BrokerLimits = {
      ...testLimits,
      streamDefaults: { ...testLimits.streamDefaults, replicas: 3 },
    };

    const error = await rejectionOf(broker.apply(orders.plan, limits));

    expect(error.message).toContain(`The stream ${orders.stream} could not be applied: `);
    expect(error.message).toContain('replicas');
    expect(error.cause).toBeInstanceOf(JetStreamApiError);
  });

  test('a durable consumer’s deliver policy, which NATS does not change, rejects apply naming the durable consumer, with NATS’s error as its cause', async () => {
    const prefix = aPrefix();
    const orders = anOrders(prefix);
    await arrangeStream(server.url, {
      name: orders.stream,
      subjects: [orders.charge, orders.created],
    });
    await arrangeDurable(server.url, orders.stream, {
      durable_name: orders.chargeDurable,
      filter_subject: orders.charge,
      ack_policy: 'explicit',
      deliver_policy: 'new',
    });
    const broker = jetstream({ connect: aConnect().connect, prefix });

    const error = await rejectionOf(broker.apply(orders.plan, testLimits));

    expect(error.message).toContain(
      `The durable consumer ${orders.chargeDurable} could not be applied: `,
    );
    expect(error.cause).toBeInstanceOf(JetStreamApiError);
  });

  test('apply refuses a plan whose shape is not the documented one, such as broker-plan’s errors document, without calling connect', async () => {
    const service = aConnect();
    const broker = jetstream({ connect: service.connect, prefix: aPrefix() });
    const errorsDocument = JSON.parse('{"errors":["no snapshot"]}');

    const error = await rejectionOf(broker.apply(errorsDocument, testLimits));

    expect(error.message).toBe(
      'The broker plan is not the shape cf-loom broker-plan --json prints: prefix is missing',
    );
    expect(service.opened).toHaveLength(0);
  });

  test.each([
    ['staging', 't-prefix', "The broker plan's prefix is staging, but this broker's is t-prefix"],
    [null, 't-prefix', "The broker plan's prefix is none, but this broker's is t-prefix"],
    ['staging', undefined, "The broker plan's prefix is staging, but this broker's is none"],
  ])(
    'apply refuses a plan whose prefix is %s on a broker whose prefix is %s, naming both, without calling connect',
    async (planPrefix, brokerPrefix, message) => {
      const service = aConnect();
      const broker = jetstream({ connect: service.connect, prefix: brokerPrefix });
      const plan: BrokerPlan = { prefix: planPrefix, streams: {}, consumers: {} };

      const error = await rejectionOf(broker.apply(plan, testLimits));

      expect(error.message).toBe(message);
      expect(service.opened).toHaveLength(0);
    },
  );

  test('apply refuses every setting left unset, naming each stream or durable consumer and the setting, without calling connect', async () => {
    const prefix = aPrefix();
    const orders = anOrders(prefix);
    const billing = aBilling(prefix);
    const plan: BrokerPlan = {
      prefix,
      streams: orders.plan.streams,
      consumers: { ...orders.plan.consumers, ...billing.plan.consumers },
    };
    const service = aConnect();
    const broker = jetstream({ connect: service.connect, prefix });
    const limits: BrokerLimits = {
      streamDefaults: { retention: 'limits', replicas: 1, storage: 'file' },
      consumers: { [billing.durable]: { deliverPolicy: 'all', ackWait: '30s' } },
    };

    const error = await rejectionOf(broker.apply(plan, limits));

    expect(error.message).toBe(
      [
        `The stream ${orders.stream} has no maxAge, duplicateWindow in limits.streams or limits.streamDefaults`,
        `The durable consumer ${orders.chargeDurable} has no deliverPolicy, ackWait, maxDeliver, maxAckPending in limits.consumers or limits.consumerDefaults`,
        `The durable consumer ${billing.durable} has no maxDeliver, maxAckPending in limits.consumers or limits.consumerDefaults`,
      ].join('\n'),
    );
    expect(service.opened).toHaveLength(0);
  });

  test('apply refuses an undefined setting and an undefined entry that no default fills, as unset', async () => {
    const prefix = aPrefix();
    const orders = anOrders(prefix);
    const service = aConnect();
    const broker = jetstream({ connect: service.connect, prefix });
    const limits: BrokerLimits = {
      streamDefaults: { ...testLimits.streamDefaults, maxAge: undefined },
      consumerDefaults: undefined,
      consumers: { [orders.chargeDurable]: undefined },
    };

    const error = await rejectionOf(broker.apply(orders.plan, limits));

    expect(error.message).toBe(
      [
        `The stream ${orders.stream} has no maxAge in limits.streams or limits.streamDefaults`,
        `The durable consumer ${orders.chargeDurable} has no deliverPolicy, ackWait, maxDeliver, maxAckPending in limits.consumers or limits.consumerDefaults`,
      ].join('\n'),
    );
    expect(service.opened).toHaveLength(0);
  });

  test.each([
    [
      'a duration that is no duration',
      { streamDefaults: { maxAge: '7 days' } },
      "limits.streamDefaults.maxAge '7 days' is not a duration such as 500ms, 30s, 2m, 1h or 7d, or 'unlimited'",
    ],
    [
      'a duration with a fraction',
      { streamDefaults: { duplicateWindow: '1.5s' } },
      "limits.streamDefaults.duplicateWindow '1.5s' is not a duration such as 500ms, 30s, 2m, 1h or 7d",
    ],
    [
      'a duration of zero',
      { consumerDefaults: { ackWait: '0s' } },
      "limits.consumerDefaults.ackWait '0s' is not a duration such as 500ms, 30s, 2m, 1h or 7d, or a list of them",
    ],
    [
      'a duration of millions of years',
      { streamDefaults: { maxAge: '999999999999d' } },
      "limits.streamDefaults.maxAge '999999999999d' is not a duration such as 500ms, 30s, 2m, 1h or 7d, or 'unlimited'",
    ],
    [
      'a duration beyond what NATS counts, 64 bits of nanoseconds',
      { streamDefaults: { maxAge: '106752d' } },
      "limits.streamDefaults.maxAge '106752d' is not a duration such as 500ms, 30s, 2m, 1h or 7d, or 'unlimited'",
    ],
    [
      'a duration whose nanoseconds a number cannot hold exactly',
      { streamDefaults: { duplicateWindow: '9000000000001ms' } },
      "limits.streamDefaults.duplicateWindow '9000000000001ms' is not a duration such as 500ms, 30s, 2m, 1h or 7d",
    ],
    [
      'no replicas',
      { streamDefaults: { replicas: 0 } },
      'limits.streamDefaults.replicas 0 is not a whole number from 1',
    ],
    [
      'a retention NATS does not have',
      { streamDefaults: { retention: 'forever' } },
      "limits.streamDefaults.retention 'forever' is not one of limits, interest or workqueue",
    ],
    [
      'a max deliver that is neither a count nor unlimited',
      { consumerDefaults: { maxDeliver: 'many' } },
      "limits.consumerDefaults.maxDeliver 'many' is not a whole number from 1, or 'unlimited'",
    ],
    [
      'an empty list of ack waits',
      { consumerDefaults: { ackWait: [] } },
      'limits.consumerDefaults.ackWait [] is not a duration such as 500ms, 30s, 2m, 1h or 7d, or a list of them',
    ],
    ['limits that are no object', 'unlimited', 'limits is not an object'],
  ])('apply refuses %s, naming where it is, without calling connect', async (_, limits, line) => {
    const service = aConnect();
    const prefix = aPrefix();
    const broker = jetstream({ connect: service.connect, prefix });

    const error = await rejectionOf(broker.apply(anOrders(prefix).plan, readFromJson(limits)));

    expect(error.message).toBe(line);
    expect(service.opened).toHaveLength(0);
  });

  test('apply refuses a setting name limits does not know, in the defaults or in one stream’s own limits, naming each', async () => {
    const prefix = aPrefix();
    const orders = anOrders(prefix);
    const service = aConnect();
    const broker = jetstream({ connect: service.connect, prefix });
    const limits = readFromJson({
      ...testLimits,
      streamDefaults: { ...testLimits.streamDefaults, maxage: '1h' },
      consumerDefaults: { ...testLimits.consumerDefaults, backoff: ['1s'] },
      streams: { [orders.stream]: { replica: 1 } },
      other: {},
    });

    const error = await rejectionOf(broker.apply(orders.plan, limits));

    expect(error.message.split('\n').sort()).toEqual(
      [
        'limits.other is a key BrokerLimits does not define',
        'limits.streamDefaults.maxage is a key BrokerLimits does not define',
        'limits.consumerDefaults.backoff is a key BrokerLimits does not define',
        `limits.streams.${orders.stream}.replica is a key BrokerLimits does not define`,
      ].sort(),
    );
    expect(service.opened).toHaveLength(0);
  });

  test('apply refuses a setting name limits does not know even when its value is undefined', async () => {
    const prefix = aPrefix();
    const service = aConnect();
    const broker = jetstream({ connect: service.connect, prefix });
    const limits = {
      ...testLimits,
      streamDefaults: { ...testLimits.streamDefaults, maxBytes: undefined },
    };

    const error = await rejectionOf(broker.apply(anOrders(prefix).plan, limits));

    expect(error.message).toBe(
      'limits.streamDefaults.maxBytes is a key BrokerLimits does not define',
    );
    expect(service.opened).toHaveLength(0);
  });

  test('apply refuses a limit keyed by a name the plan does not list, naming each', async () => {
    const prefix = aPrefix();
    const orders = anOrders(prefix);
    const service = aConnect();
    const broker = jetstream({ connect: service.connect, prefix });
    const limits: BrokerLimits = {
      ...testLimits,
      streams: { [`${prefix}_ordres-service`]: { replicas: 1 } },
      consumers: { [`${prefix}_orders-service_command_ChargeCard_v2`]: { ackWait: '2m' } },
    };

    const error = await rejectionOf(broker.apply(orders.plan, limits));

    expect(error.message).toBe(
      [
        `limits.streams names ${prefix}_ordres-service, which the plan does not list`,
        `limits.consumers names ${prefix}_orders-service_command_ChargeCard_v2, which the plan does not list`,
      ].join('\n'),
    );
    expect(service.opened).toHaveLength(0);
  });
});

describe('the connection applying a broker plan uses', () => {
  test('apply calls the Service’s connect once and drains that connection when it succeeds', async () => {
    const prefix = aPrefix();
    const service = aConnect();
    const broker = jetstream({ connect: service.connect, prefix });
    const connectedBefore = service.opened.length;

    await broker.apply(anOrders(prefix).plan, testLimits);

    expect(connectedBefore).toBe(0);
    expect(service.opened.map((connection) => connection.isClosed())).toEqual([true]);
  });

  test('apply drains the connection when NATS refuses', async () => {
    const prefix = aPrefix();
    const orders = anOrders(prefix);
    await arrangeStream(
      server.url,
      { name: orders.stream, subjects: [orders.charge, orders.created] },
      { storage: 'memory' },
    );
    const service = aConnect();
    const broker = jetstream({ connect: service.connect, prefix });

    const error = await rejectionOf(broker.apply(orders.plan, testLimits));

    expect(error.cause).toBeInstanceOf(JetStreamApiError);
    expect(service.opened.map((connection) => connection.isClosed())).toEqual([true]);
  });

  test('apply drains the connection when it refuses a durable consumer whose stream does not exist', async () => {
    const prefix = aPrefix();
    const service = aConnect();
    const broker = jetstream({ connect: service.connect, prefix });

    await rejectionOf(broker.apply(aBilling(prefix).plan, testLimits));

    expect(service.opened.map((connection) => connection.isClosed())).toEqual([true]);
  });

  test('apply rejects with the error the Service’s connect rejected with', async () => {
    const prefix = aPrefix();
    const error = new Error('no route to NATS');
    const broker = jetstream({ connect: () => Promise.reject(error), prefix });

    const applying = broker.apply(anOrders(prefix).plan, testLimits);

    await expect(applying).rejects.toBe(error);
  });

  test('a failure of the NATS client while applying a stream rejects apply naming the stream, with the client’s error as its cause', async () => {
    const prefix = aPrefix();
    const orders = anOrders(prefix);
    const clientError = new Error('the Broker did not answer');
    const connectFailing = async () => {
      const connection = await connect({ servers: server.url });
      onTestFinished(() => connection.close());
      return withMethods(connection, { request: () => Promise.reject(clientError) });
    };
    const broker = jetstream({ connect: connectFailing, prefix });

    const error = await rejectionOf(broker.apply(orders.plan, testLimits));

    expect(error.message).toBe(
      `The stream ${orders.stream} could not be applied: the Broker did not answer`,
    );
    expect(error.cause).toBe(clientError);
  });

  test('the jetstream options reach apply: an unknown domain rejects apply naming the first stream, with the client’s error as its cause', async () => {
    const prefix = aPrefix();
    const orders = anOrders(prefix);
    const service = aConnect();
    const broker = jetstream({
      connect: service.connect,
      prefix,
      jetstream: { domain: 'nowhere' },
    });

    const error = await rejectionOf(broker.apply(orders.plan, testLimits));

    expect(error.message).toContain(`The stream ${orders.stream} could not be applied: `);
    expect(error.message).toContain('jetstream is not enabled');
    expect(error.cause).toBeInstanceOf(Error);
  });

  test('the plan cf-loom derives for a Service, applied, lets messaging() through the same jetstream() connect', async () => {
    const prefix = aPrefix();
    const plan = JSON.parse(JSON.stringify(planOf(contract, prefix)));
    const broker = jetstream({ connect: aConnect().connect, prefix });
    await broker.apply(plan, testLimits);

    const opening = messaging(contract, broker);

    await expect(opening).resolves.toBeDefined();
  });
});
