// biome-ignore-all lint/style/useNamingConvention: nats.js spells its settings in snake case
import {
  defineCommand,
  defineEvent,
  defineGroup,
  defineService,
  defineSubscription,
} from '@cf-loom/contract';
import { handle, readersOf } from '@cf-loom/handlers';
import {
  type ConsumerConfig,
  JetStreamApiError,
  jetstream as jetStreamClientOf,
} from '@nats-io/jetstream';
import type { NatsConnection } from '@nats-io/nats-core';
import { connect } from '@nats-io/transport-node';
import { afterAll, beforeAll, describe, expect, onTestFinished, test } from 'vitest';
import { z } from 'zod';
import { stopServerUnder, withMethods } from '../../test/connections.ts';
import {
  arrangeDurableConsumer,
  durableConsumerConfigOf,
  durableConsumerInfoOf,
} from '../../test/durable-consumers.ts';
import { aNatsServer, type NatsServer } from '../../test/nats-server.ts';
import { arrangeStream, planOf, streamConfigOf, streamInfoOf } from '../../test/streams.ts';
import { messaging } from '../index.ts';
import { applyBrokerPlan, type BrokerLimits, type BrokerPlan, jetstream } from './index.ts';

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

const contract = defineService({
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

/** Every setting a stream and a Durable consumer needs, as the files the arranged ones are made with. */
const testLimits: BrokerLimits = {
  streamDefaults: {
    retention: 'limits',
    maxAge: '7d',
    duplicateWindow: '2m',
    replicas: 1,
    storage: 'file',
  },
  durableConsumerDefaults: {
    deliverPolicy: 'all',
    ackWait: '30s',
    maxDeliver: 5,
    maxAckPending: 100,
  },
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
    durableConsumers: {
      [chargeDurable]: { service: 'orders-service', stream, subject: charge },
    },
  };
  return { stream, created, charge, chargeDurable, plan };
}

type Orders = ReturnType<typeof anOrders>;

/** Billing’s plan under a prefix: no stream, and one Durable consumer on Orders’ stream. */
function aBilling(prefix: string) {
  const orders = anOrders(prefix);
  const durable = `${prefix}_billing-service_draft-invoice-on-created`;
  const plan: BrokerPlan = {
    prefix,
    streams: {},
    durableConsumers: {
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

/** The settings of a Durable consumer that pulls Orders’ Command, with `extra` over them. */
function pullingCharge(
  orders: Orders,
  extra: Partial<ConsumerConfig> = {},
): Partial<ConsumerConfig> {
  return { ack_policy: 'explicit', filter_subject: orders.charge, ...extra };
}

/** The Handlers `consume` needs for Orders’ plan: one for its Command, which does nothing. */
function chargeHandlers() {
  const readers = readersOf({
    commands: { chargeCardV1: { declaration: chargeCardV1, reader: orderBody } },
    subscriptions: {},
  });
  return {
    commands: { chargeCardV1: handle(readers.commands.chargeCardV1, async () => undefined) },
    subscriptions: {},
    readers,
  };
}

/** A Service whose names have 64 characters, a Subscription's with the most capitals, its Command at the largest Message Version. */
function aServiceOfLongestNames() {
  const kebab = 'a'.repeat(64);
  const subscribed = `aa${'Bb'.repeat(31)}`;
  const pascal = (initial: string) => `${initial}${'a'.repeat(63)}`;
  const created = defineEvent({
    name: pascal('A'),
    version: 1,
    visibility: 'internal',
    description: 'An order was created',
    body: orderBody,
  });
  const charge = defineCommand({
    name: pascal('B'),
    version: Number.MAX_SAFE_INTEGER,
    description: 'Charges the order’s card',
    body: orderBody,
  });
  const onCreated = defineSubscription({
    name: subscribed,
    description: 'Receives the order created',
    event: created,
  });
  const group = defineGroup({
    name: kebab,
    description: 'Messages',
    events: [created],
    commands: [charge],
    subscriptions: [onCreated],
  });
  return {
    contract: defineService({ name: kebab, groups: [group] }),
    prefix: 'p'.repeat(64),
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
  throw new Error('applyBrokerPlan did not reject');
}

describe('applyBrokerPlan', () => {
  test('applyBrokerPlan applies the plan of the longest names the grammars accept, under the longest prefix', async () => {
    const { contract: longest, prefix } = aServiceOfLongestNames();
    const plan = planOf(longest, prefix);
    const connecting = { connect: aConnect().connect };
    const [stream = ''] = Object.keys(plan.streams);
    const durableConsumers = Object.entries(plan.durableConsumers);

    await applyBrokerPlan(connecting, plan, testLimits);

    const streamApplied = await streamConfigOf(server.url, stream);
    const configsApplied = await Promise.all(
      durableConsumers.map(([name]) => durableConsumerConfigOf(server.url, stream, name)),
    );
    const names = [stream, ...durableConsumers.map(([name]) => name)];
    expect(streamApplied.name).toBe(stream);
    expect(configsApplied.map((config) => config.durable_name)).toEqual(names.slice(1));
    expect(names.map((name) => name.length).sort((a, b) => a - b)).toEqual([129, 220, 225]);
  });

  test('applyBrokerPlan creates each stream of the plan with its subjects, retention, max age, duplicate window, replicas and storage', async () => {
    const prefix = aPrefix();
    const orders = anOrders(prefix);
    const connecting = { connect: aConnect().connect };
    const limits: BrokerLimits = {
      streamDefaults: {
        retention: 'interest',
        maxAge: '1h',
        duplicateWindow: '90s',
        replicas: 1,
        storage: 'memory',
      },
      durableConsumerDefaults: testLimits.durableConsumerDefaults,
    };

    await applyBrokerPlan(connecting, orders.plan, limits);

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

  test('applyBrokerPlan creates each Durable consumer as a pull consumer with explicit acknowledgements, filtered on the plan’s subject', async () => {
    const prefix = aPrefix();
    const orders = anOrders(prefix);
    const connecting = { connect: aConnect().connect };
    const limits: BrokerLimits = {
      ...testLimits,
      durableConsumerDefaults: {
        deliverPolicy: 'new',
        ackWait: '45s',
        maxDeliver: 7,
        maxAckPending: 20,
      },
    };

    await applyBrokerPlan(connecting, orders.plan, limits);

    const config = await durableConsumerConfigOf(server.url, orders.stream, orders.chargeDurable);
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

  test('a stream’s or Durable consumer’s own limits override the defaults setting by setting', async () => {
    const prefix = aPrefix();
    const orders = anOrders(prefix);
    const connecting = { connect: aConnect().connect };
    const limits: BrokerLimits = {
      ...testLimits,
      streams: { [orders.stream]: { maxAge: '2h' } },
      durableConsumers: { [orders.chargeDurable]: { ackWait: '2m', maxDeliver: 9 } },
    };

    await applyBrokerPlan(connecting, orders.plan, limits);

    const stream = await streamConfigOf(server.url, orders.stream);
    const config = await durableConsumerConfigOf(server.url, orders.stream, orders.chargeDurable);
    expect(stream).toMatchObject({
      max_age: 7200 * nanosPerSecond,
      duplicate_window: 120 * nanosPerSecond,
    });
    expect(config).toMatchObject({
      ack_wait: 120 * nanosPerSecond,
      max_deliver: 9,
      max_ack_pending: 100,
    });
  });

  test('applyBrokerPlan adds the plan’s subjects to an existing stream and keeps the subjects it already held', async () => {
    const prefix = aPrefix();
    const orders = anOrders(prefix);
    const other = `${prefix}.orders-service.other`;
    await arrangeStream(server.url, { name: orders.stream, subjects: [other, orders.created] });
    const connecting = { connect: aConnect().connect };

    await applyBrokerPlan(connecting, orders.plan, testLimits);

    const { subjects } = await streamConfigOf(server.url, orders.stream);
    expect([...subjects].sort()).toEqual([other, orders.charge, orders.created].sort());
  });

  test('applyBrokerPlan adds no subject to a stream that already holds it through a wildcard', async () => {
    const prefix = aPrefix();
    const orders = anOrders(prefix);
    const wildcard = `${prefix}.orders-service.>`;
    await arrangeStream(server.url, { name: orders.stream, subjects: [wildcard] });
    const connecting = { connect: aConnect().connect };

    await applyBrokerPlan(connecting, orders.plan, testLimits);

    const { subjects } = await streamConfigOf(server.url, orders.stream);
    expect(subjects).toEqual([wildcard]);
  });

  test('applyBrokerPlan updates the limits of an existing stream and Durable consumer that NATS lets change and keeps the settings limits does not name', async () => {
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
    await arrangeDurableConsumer(server.url, orders.stream, {
      durable_name: orders.chargeDurable,
      filter_subject: orders.charge,
      ack_policy: 'explicit',
      ack_wait: 10 * nanosPerSecond,
      max_deliver: 3,
      max_ack_pending: 7,
      description: 'arranged by hand',
    });
    const connecting = { connect: aConnect().connect };
    const limits: BrokerLimits = {
      ...testLimits,
      streams: { [orders.stream]: { retention: 'interest' } },
    };

    await applyBrokerPlan(connecting, orders.plan, limits);

    const stream = await streamConfigOf(server.url, orders.stream);
    const config = await durableConsumerConfigOf(server.url, orders.stream, orders.chargeDurable);
    expect(stream).toMatchObject({
      retention: 'interest',
      max_age: 604_800 * nanosPerSecond,
      duplicate_window: 120 * nanosPerSecond,
      num_replicas: 1,
      storage: 'file',
      max_bytes: 1_000_000,
    });
    expect(config).toMatchObject({
      deliver_policy: 'all',
      ack_wait: 30 * nanosPerSecond,
      max_deliver: 5,
      max_ack_pending: 100,
      description: 'arranged by hand',
    });
  });

  test('applying the same plan twice leaves the streams, Durable consumers and stored Messages as the first applyBrokerPlan left them', async () => {
    const prefix = aPrefix();
    const orders = anOrders(prefix);
    const service = aConnect();
    const connecting = { connect: service.connect };
    await applyBrokerPlan(connecting, orders.plan, testLimits);
    const connection = await service.connect();
    await jetStreamClientOf(connection).publish(orders.created, '{}');
    const first = await streamInfoOf(server.url, orders.stream);
    const firstConfig = await durableConsumerConfigOf(
      server.url,
      orders.stream,
      orders.chargeDurable,
    );

    await applyBrokerPlan(connecting, orders.plan, testLimits);

    const again = await streamInfoOf(server.url, orders.stream);
    const againConfig = await durableConsumerConfigOf(
      server.url,
      orders.stream,
      orders.chargeDurable,
    );
    expect(again.config).toEqual(first.config);
    expect(again.state.messages).toBe(first.state.messages);
    expect(first.state.messages).toBe(1);
    expect(againConfig).toEqual(firstConfig);
  });

  test('applyBrokerPlan creates a Durable consumer on a stream the same plan creates', async () => {
    const prefix = aPrefix();
    const orders = anOrders(prefix);
    const connecting = { connect: aConnect().connect };

    await applyBrokerPlan(connecting, orders.plan, testLimits);

    const info = await durableConsumerInfoOf(server.url, orders.stream, orders.chargeDurable);
    expect(info?.stream_name).toBe(orders.stream);
  });

  test('a plan with no stream creates only its Durable consumers, on its Provider’s existing stream', async () => {
    const prefix = aPrefix();
    const billing = aBilling(prefix);
    await applyBrokerPlan({ connect: aConnect().connect }, billing.orders.plan, testLimits);
    const connecting = { connect: aConnect().connect };

    await applyBrokerPlan(connecting, billing.plan, testLimits);

    const info = await durableConsumerInfoOf(server.url, billing.orders.stream, billing.durable);
    expect(info?.config.filter_subject).toBe(billing.orders.created);
  });

  test('applyBrokerPlan never removes a subject, stream or Durable consumer that the plan it applies does not list', async () => {
    const prefix = aPrefix();
    const orders = anOrders(prefix);
    const leftover = `${prefix}.orders-service.event.OrderCancelled.v1`;
    const leftoverDurable = `${prefix}_orders-service_notify-on-cancelled`;
    await arrangeStream(server.url, { name: orders.stream, subjects: [leftover] });
    await arrangeStream(server.url, {
      name: `${prefix}_retired-service`,
      subjects: [`${prefix}.r`],
    });
    await arrangeDurableConsumer(server.url, orders.stream, {
      durable_name: leftoverDurable,
      filter_subject: leftover,
      ack_policy: 'explicit',
    });
    const connecting = { connect: aConnect().connect };

    await applyBrokerPlan(connecting, orders.plan, testLimits);

    const { subjects } = await streamConfigOf(server.url, orders.stream);
    expect(subjects).toContain(leftover);
    await expect(streamConfigOf(server.url, `${prefix}_retired-service`)).resolves.toBeDefined();
    await expect(
      durableConsumerConfigOf(server.url, orders.stream, leftoverDurable),
    ).resolves.toBeDefined();
  });

  test('without a prefix, applyBrokerPlan creates the names and subjects the plan prints, unprefixed', async () => {
    const plan: BrokerPlan = {
      prefix: null,
      streams: {
        'unprefixed-orders': {
          service: 'unprefixed-orders',
          subjects: ['unprefixed-orders.event.A.v1'],
        },
      },
      durableConsumers: {
        'unprefixed-orders_command_B_v1': {
          service: 'unprefixed-orders',
          stream: 'unprefixed-orders',
          subject: 'unprefixed-orders.event.A.v1',
        },
      },
    };
    const connecting = { connect: aConnect().connect };

    await applyBrokerPlan(connecting, plan, testLimits);

    const stream = await streamConfigOf(server.url, 'unprefixed-orders');
    const config = await durableConsumerConfigOf(
      server.url,
      'unprefixed-orders',
      'unprefixed-orders_command_B_v1',
    );
    expect(stream.subjects).toEqual(['unprefixed-orders.event.A.v1']);
    expect(config.filter_subject).toBe('unprefixed-orders.event.A.v1');
  });

  test('"unlimited" reaches NATS as no limit: max age 0, max deliver -1 and max ack pending -1', async () => {
    const prefix = aPrefix();
    const orders = anOrders(prefix);
    const connecting = { connect: aConnect().connect };
    const limits: BrokerLimits = {
      streamDefaults: { ...testLimits.streamDefaults, maxAge: 'unlimited' },
      durableConsumerDefaults: {
        ...testLimits.durableConsumerDefaults,
        maxDeliver: 'unlimited',
        maxAckPending: 'unlimited',
      },
    };

    await applyBrokerPlan(connecting, orders.plan, limits);

    const stream = await streamConfigOf(server.url, orders.stream);
    const config = await durableConsumerConfigOf(server.url, orders.stream, orders.chargeDurable);
    expect(stream.max_age).toBe(0);
    expect(config).toMatchObject({ max_deliver: -1, max_ack_pending: -1 });
  });

  test('a duration of a year reaches NATS exactly, in nanoseconds', async () => {
    const prefix = aPrefix();
    const orders = anOrders(prefix);
    const connecting = { connect: aConnect().connect };
    const limits: BrokerLimits = {
      ...testLimits,
      streamDefaults: { ...testLimits.streamDefaults, maxAge: '365d' },
    };

    await applyBrokerPlan(connecting, orders.plan, limits);

    const stream = await streamConfigOf(server.url, orders.stream);
    expect(stream.max_age).toBe(31_536_000_000_000_000);
  });

  test('the longest duration NATS holds in 64 bits reaches it exactly, in nanoseconds', async () => {
    const prefix = aPrefix();
    const orders = anOrders(prefix);
    const connecting = { connect: aConnect().connect };
    const limits: BrokerLimits = {
      ...testLimits,
      streamDefaults: { ...testLimits.streamDefaults, maxAge: '106751d' },
    };

    await applyBrokerPlan(connecting, orders.plan, limits);

    const stream = await streamConfigOf(server.url, orders.stream);
    expect(stream.max_age).toBe(9_223_286_400_000_000_000);
  });

  test('an undefined setting in a stream’s or Durable consumer’s own limits leaves the default in place', async () => {
    const prefix = aPrefix();
    const orders = anOrders(prefix);
    const connecting = { connect: aConnect().connect };
    const limits: BrokerLimits = {
      ...testLimits,
      streams: { [orders.stream]: { maxAge: undefined, replicas: undefined } },
      durableConsumers: { [orders.chargeDurable]: { ackWait: undefined } },
    };

    await applyBrokerPlan(connecting, orders.plan, limits);

    const stream = await streamConfigOf(server.url, orders.stream);
    const config = await durableConsumerConfigOf(server.url, orders.stream, orders.chargeDurable);
    expect(stream).toMatchObject({ max_age: 604_800 * nanosPerSecond, num_replicas: 1 });
    expect(config.ack_wait).toBe(30 * nanosPerSecond);
  });

  test('an undefined entry for a stream, a Durable consumer or a name the plan does not list leaves the defaults in place', async () => {
    const prefix = aPrefix();
    const orders = anOrders(prefix);
    const connecting = { connect: aConnect().connect };
    const limits: BrokerLimits = {
      ...testLimits,
      streams: { [orders.stream]: undefined, [`${prefix}_unlisted`]: undefined },
      durableConsumers: {
        [orders.chargeDurable]: undefined,
        [`${prefix}_unlisted_durable`]: undefined,
      },
    };

    await applyBrokerPlan(connecting, orders.plan, limits);

    const stream = await streamConfigOf(server.url, orders.stream);
    expect(stream.max_age).toBe(604_800 * nanosPerSecond);
  });

  test('a list of ack waits reaches NATS as its backoff, the first as the ack wait', async () => {
    const prefix = aPrefix();
    const orders = anOrders(prefix);
    const connecting = { connect: aConnect().connect };
    const limits: BrokerLimits = {
      ...testLimits,
      durableConsumerDefaults: {
        ...testLimits.durableConsumerDefaults,
        ackWait: ['30s', '1m', '5m'],
      },
    };

    await applyBrokerPlan(connecting, orders.plan, limits);

    const config = await durableConsumerConfigOf(server.url, orders.stream, orders.chargeDurable);
    expect(config.ack_wait).toBe(30 * nanosPerSecond);
    expect(config.backoff).toEqual([
      30 * nanosPerSecond,
      60 * nanosPerSecond,
      300 * nanosPerSecond,
    ]);
  });

  test('an update that sets one ack wait clears the backoff the Durable consumer had', async () => {
    const prefix = aPrefix();
    const orders = anOrders(prefix);
    const connecting = { connect: aConnect().connect };
    const withBackoff: BrokerLimits = {
      ...testLimits,
      durableConsumerDefaults: { ...testLimits.durableConsumerDefaults, ackWait: ['30s', '1m'] },
    };
    await applyBrokerPlan(connecting, orders.plan, withBackoff);

    await applyBrokerPlan(connecting, orders.plan, {
      ...testLimits,
      durableConsumers: { [orders.chargeDurable]: { ackWait: '2m' } },
    });

    const config = await durableConsumerConfigOf(server.url, orders.stream, orders.chargeDurable);
    expect(config.ack_wait).toBe(120 * nanosPerSecond);
    expect(config.backoff ?? []).toEqual([]);
  });
});

describe('applyBrokerPlan on a Durable consumer cf-loom cannot pull from', () => {
  test('applyBrokerPlan turns off headers only on an existing Durable consumer', async () => {
    const prefix = aPrefix();
    const orders = anOrders(prefix);
    await arrangeOrdersStream(orders);
    await arrangeDurableConsumer(server.url, orders.stream, {
      durable_name: orders.chargeDurable,
      filter_subject: orders.charge,
      ack_policy: 'explicit',
      headers_only: true,
    });
    const connecting = { connect: aConnect().connect };

    await applyBrokerPlan(connecting, orders.plan, testLimits);

    const config = await durableConsumerConfigOf(server.url, orders.stream, orders.chargeDurable);
    expect(config.headers_only ?? false).toBe(false);
  });

  test('applyBrokerPlan clears the priority groups, policy and timeout of an existing Durable consumer', async () => {
    const prefix = aPrefix();
    const orders = anOrders(prefix);
    await arrangeOrdersStream(orders);
    await arrangeDurableConsumer(server.url, orders.stream, {
      durable_name: orders.chargeDurable,
      filter_subject: orders.charge,
      ack_policy: 'explicit',
      priority_groups: ['g'],
      priority_policy: 'pinned_client',
      priority_timeout: 120 * nanosPerSecond,
    });
    const connecting = { connect: aConnect().connect };

    await applyBrokerPlan(connecting, orders.plan, testLimits);

    const config = await durableConsumerConfigOf(server.url, orders.stream, orders.chargeDurable);
    expect(config.priority_groups ?? []).toEqual([]);
    expect(config.priority_policy ?? 'none').toBe('none');
    expect(config.priority_timeout ?? 0).toBe(0);
  });

  test('applyBrokerPlan sets filter_subject on a Durable consumer filtered on its subject through filter_subjects, and leaves filter_subjects unset', async () => {
    const prefix = aPrefix();
    const orders = anOrders(prefix);
    await arrangeOrdersStream(orders);
    await arrangeDurableConsumer(server.url, orders.stream, {
      durable_name: orders.chargeDurable,
      ack_policy: 'explicit',
      filter_subjects: [orders.charge],
    });
    const connecting = { connect: aConnect().connect };

    await applyBrokerPlan(connecting, orders.plan, testLimits);

    const config = await durableConsumerConfigOf(server.url, orders.stream, orders.chargeDurable);
    expect(config.filter_subject).toBe(orders.charge);
    expect(config.filter_subjects ?? []).toEqual([]);
  });

  test.each<[string, (orders: Orders) => Partial<ConsumerConfig>]>([
    ['delivers headers only', (orders) => pullingCharge(orders, { headers_only: true })],
    [
      'has priority groups pinned to a client',
      (orders) =>
        pullingCharge(orders, { priority_groups: ['g'], priority_policy: 'pinned_client' }),
    ],
    [
      'has priority groups with the overflow policy',
      (orders) =>
        pullingCharge(orders, { priority_groups: ['g', 'h'], priority_policy: 'overflow' }),
    ],
    [
      'is filtered on another subject',
      (orders) => pullingCharge(orders, { filter_subject: orders.created }),
    ],
    [
      'is filtered on another subject through filter_subjects',
      (orders) => ({ ack_policy: 'explicit', filter_subjects: [orders.created] }),
    ],
    [
      'is filtered on two subjects through filter_subjects',
      (orders) => ({
        ack_policy: 'explicit',
        filter_subjects: [orders.charge, orders.created],
      }),
    ],
  ])(
    'a Durable consumer that %s is refused by consume until applyBrokerPlan ran, and accepted after',
    async (_name, settings) => {
      const prefix = aPrefix();
      const orders = anOrders(prefix);
      await arrangeOrdersStream(orders);
      await arrangeDurableConsumer(server.url, orders.stream, {
        durable_name: orders.chargeDurable,
        ...settings(orders),
      });
      const opened = await messaging(contract, jetstream({ connect: aConnect().connect, prefix }));
      onTestFinished(() => opened.close());
      const handlers = chargeHandlers();
      await expect(opened.consume(handlers, {})).rejects.toThrow(
        `The Durable consumer ${orders.chargeDurable} `,
      );

      await applyBrokerPlan({ connect: aConnect().connect }, orders.plan, testLimits);

      await expect(opened.consume(handlers, {})).resolves.toBeUndefined();
    },
  );

  test.each([
    ['does not acknowledge explicitly', { ack_policy: 'none' as const }, 'has the ack policy none'],
    ['is a push consumer', { deliver_subject: 'somewhere.else' }, 'is a push consumer'],
  ])(
    'a Durable consumer that %s, which NATS does not change, rejects applyBrokerPlan and is still refused by consume',
    async (_name, settings, difference) => {
      const prefix = aPrefix();
      const orders = anOrders(prefix);
      await arrangeOrdersStream(orders);
      await arrangeDurableConsumer(server.url, orders.stream, {
        durable_name: orders.chargeDurable,
        filter_subject: orders.charge,
        ack_policy: 'explicit',
        ...settings,
      });
      const opened = await messaging(contract, jetstream({ connect: aConnect().connect, prefix }));
      onTestFinished(() => opened.close());

      const applying = applyBrokerPlan({ connect: aConnect().connect }, orders.plan, testLimits);

      const error = await rejectionOf(applying);

      expect(error.message).toContain(
        `The Durable consumer ${orders.chargeDurable} could not be applied: `,
      );
      await expect(opened.consume(chargeHandlers(), {})).rejects.toThrow(
        `The Durable consumer ${orders.chargeDurable} ${difference}`,
      );
    },
  );
});

describe('what applyBrokerPlan refuses', () => {
  test('applyBrokerPlan refuses a Durable consumer whose stream does not exist yet, naming the stream, and keeps the streams it created', async () => {
    const prefix = aPrefix();
    const billing = aBilling(prefix);
    const own = `${prefix}_billing-service`;
    const plan: BrokerPlan = {
      ...billing.plan,
      streams: {
        [own]: { service: 'billing-service', subjects: [`${prefix}.billing-service.event.X.v1`] },
      },
    };
    const connecting = { connect: aConnect().connect };

    const error = await rejectionOf(applyBrokerPlan(connecting, plan, testLimits));

    expect(error.message).toBe(
      `The Durable consumer ${billing.durable} reads the stream ${billing.orders.stream}, which does not exist yet: apply its Service's plan first`,
    );
    await expect(streamConfigOf(server.url, own)).resolves.toBeDefined();
    await expect(durableConsumerInfoOf(server.url, own, billing.durable)).resolves.toBeUndefined();
  });

  test('applying again once the missing stream exists completes the plan', async () => {
    const prefix = aPrefix();
    const billing = aBilling(prefix);
    const connecting = { connect: aConnect().connect };
    await rejectionOf(applyBrokerPlan(connecting, billing.plan, testLimits));
    await applyBrokerPlan(connecting, billing.orders.plan, testLimits);

    await applyBrokerPlan(connecting, billing.plan, testLimits);

    const info = await durableConsumerInfoOf(server.url, billing.orders.stream, billing.durable);
    expect(info?.config.filter_subject).toBe(billing.orders.created);
  });

  test('applyBrokerPlan stops at the first Durable consumer it cannot apply and creates none after it', async () => {
    const prefix = aPrefix();
    const orders = anOrders(prefix);
    await applyBrokerPlan({ connect: aConnect().connect }, orders.plan, testLimits);
    const first = `${prefix}_billing-service_first`;
    const second = `${prefix}_billing-service_second`;
    const plan: BrokerPlan = {
      prefix,
      streams: {},
      durableConsumers: {
        [first]: {
          service: 'billing-service',
          stream: `${prefix}_absent`,
          subject: orders.created,
        },
        [second]: { service: 'billing-service', stream: orders.stream, subject: orders.created },
      },
    };
    const connecting = { connect: aConnect().connect };

    const error = await rejectionOf(applyBrokerPlan(connecting, plan, testLimits));

    expect(error.message).toContain(
      `The Durable consumer ${first} reads the stream ${prefix}_absent`,
    );
    await expect(durableConsumerInfoOf(server.url, orders.stream, second)).resolves.toBeUndefined();
  });

  test('a stream’s storage, which NATS does not change, rejects applyBrokerPlan naming the stream, with NATS’s error as its cause', async () => {
    const prefix = aPrefix();
    const orders = anOrders(prefix);
    await arrangeStream(
      server.url,
      { name: orders.stream, subjects: [orders.charge, orders.created] },
      { storage: 'memory' },
    );
    const connecting = { connect: aConnect().connect };

    const error = await rejectionOf(applyBrokerPlan(connecting, orders.plan, testLimits));

    expect(error.message).toContain(`The stream ${orders.stream} could not be applied: `);
    expect(error.message).toContain('storage');
    expect(error.cause).toBeInstanceOf(JetStreamApiError);
  });

  test('more replicas than a single NATS server holds reject applyBrokerPlan naming the stream, with NATS’s error as its cause', async () => {
    const prefix = aPrefix();
    const orders = anOrders(prefix);
    const connecting = { connect: aConnect().connect };
    const limits: BrokerLimits = {
      ...testLimits,
      streamDefaults: { ...testLimits.streamDefaults, replicas: 3 },
    };

    const error = await rejectionOf(applyBrokerPlan(connecting, orders.plan, limits));

    expect(error.message).toContain(`The stream ${orders.stream} could not be applied: `);
    expect(error.message).toContain('replicas');
    expect(error.cause).toBeInstanceOf(JetStreamApiError);
  });

  test('a Durable consumer’s deliver policy, which NATS does not change, rejects applyBrokerPlan naming the Durable consumer, with NATS’s error as its cause', async () => {
    const prefix = aPrefix();
    const orders = anOrders(prefix);
    await arrangeStream(server.url, {
      name: orders.stream,
      subjects: [orders.charge, orders.created],
    });
    await arrangeDurableConsumer(server.url, orders.stream, {
      durable_name: orders.chargeDurable,
      filter_subject: orders.charge,
      ack_policy: 'explicit',
      deliver_policy: 'new',
    });
    const connecting = { connect: aConnect().connect };

    const error = await rejectionOf(applyBrokerPlan(connecting, orders.plan, testLimits));

    expect(error.message).toContain(
      `The Durable consumer ${orders.chargeDurable} could not be applied: `,
    );
    expect(error.cause).toBeInstanceOf(JetStreamApiError);
  });

  test('applyBrokerPlan refuses a plan whose shape is not the documented one, such as broker-plan’s errors document, without calling connect', async () => {
    const service = aConnect();
    const connecting = { connect: service.connect };
    const errorsDocument = JSON.parse('{"errors":["no snapshot"]}');

    const error = await rejectionOf(applyBrokerPlan(connecting, errorsDocument, testLimits));

    expect(error.message).toBe(
      'The value is not the Broker plan of the document cf-loom broker-plan --json prints: prefix is missing',
    );
    expect(service.opened).toHaveLength(0);
  });

  test('applyBrokerPlan refuses every setting left unset, naming each stream or Durable consumer and the setting, without calling connect', async () => {
    const prefix = aPrefix();
    const orders = anOrders(prefix);
    const billing = aBilling(prefix);
    const plan: BrokerPlan = {
      prefix,
      streams: orders.plan.streams,
      durableConsumers: { ...orders.plan.durableConsumers, ...billing.plan.durableConsumers },
    };
    const service = aConnect();
    const connecting = { connect: service.connect };
    const limits: BrokerLimits = {
      streamDefaults: { retention: 'limits', replicas: 1, storage: 'file' },
      durableConsumers: { [billing.durable]: { deliverPolicy: 'all', ackWait: '30s' } },
    };

    const error = await rejectionOf(applyBrokerPlan(connecting, plan, limits));

    expect(error.message).toBe(
      [
        `The stream ${orders.stream} has no maxAge, duplicateWindow in limits.streams or limits.streamDefaults`,
        `The Durable consumer ${orders.chargeDurable} has no deliverPolicy, ackWait, maxDeliver, maxAckPending in limits.durableConsumers or limits.durableConsumerDefaults`,
        `The Durable consumer ${billing.durable} has no maxDeliver, maxAckPending in limits.durableConsumers or limits.durableConsumerDefaults`,
      ].join('\n'),
    );
    expect(service.opened).toHaveLength(0);
  });

  test('applyBrokerPlan refuses an undefined setting and an undefined entry that no default fills, as unset', async () => {
    const prefix = aPrefix();
    const orders = anOrders(prefix);
    const service = aConnect();
    const connecting = { connect: service.connect };
    const limits: BrokerLimits = {
      streamDefaults: { ...testLimits.streamDefaults, maxAge: undefined },
      durableConsumerDefaults: undefined,
      durableConsumers: { [orders.chargeDurable]: undefined },
    };

    const error = await rejectionOf(applyBrokerPlan(connecting, orders.plan, limits));

    expect(error.message).toBe(
      [
        `The stream ${orders.stream} has no maxAge in limits.streams or limits.streamDefaults`,
        `The Durable consumer ${orders.chargeDurable} has no deliverPolicy, ackWait, maxDeliver, maxAckPending in limits.durableConsumers or limits.durableConsumerDefaults`,
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
      { durableConsumerDefaults: { ackWait: '0s' } },
      "limits.durableConsumerDefaults.ackWait '0s' is not a duration such as 500ms, 30s, 2m, 1h or 7d, or a list of them",
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
      { durableConsumerDefaults: { maxDeliver: 'many' } },
      "limits.durableConsumerDefaults.maxDeliver 'many' is not a whole number from 1, or 'unlimited'",
    ],
    [
      'an empty list of ack waits',
      { durableConsumerDefaults: { ackWait: [] } },
      'limits.durableConsumerDefaults.ackWait [] is not a duration such as 500ms, 30s, 2m, 1h or 7d, or a list of them',
    ],
    ['limits that are no object', 'unlimited', 'limits is not an object'],
  ])(
    'applyBrokerPlan refuses %s, naming where it is, without calling connect',
    async (_, limits, line) => {
      const service = aConnect();
      const prefix = aPrefix();
      const connecting = { connect: service.connect };

      const error = await rejectionOf(
        applyBrokerPlan(connecting, anOrders(prefix).plan, readFromJson(limits)),
      );

      expect(error.message).toBe(line);
      expect(service.opened).toHaveLength(0);
    },
  );

  test('applyBrokerPlan refuses limits that are missing from untyped code, without calling connect', async () => {
    const service = aConnect();
    const prefix = aPrefix();
    const connecting = { connect: service.connect };
    const noLimits = undefined as unknown as BrokerLimits;

    const error = await rejectionOf(applyBrokerPlan(connecting, anOrders(prefix).plan, noLimits));

    expect(error.message).toBe('limits is missing');
    expect(service.opened).toHaveLength(0);
  });

  test('applyBrokerPlan refuses a setting name limits does not know, in the defaults or in one stream’s own limits, naming each', async () => {
    const prefix = aPrefix();
    const orders = anOrders(prefix);
    const service = aConnect();
    const connecting = { connect: service.connect };
    const limits = readFromJson({
      ...testLimits,
      streamDefaults: { ...testLimits.streamDefaults, maxage: '1h' },
      durableConsumerDefaults: { ...testLimits.durableConsumerDefaults, backoff: ['1s'] },
      streams: { [orders.stream]: { replica: 1 } },
      other: {},
    });

    const error = await rejectionOf(applyBrokerPlan(connecting, orders.plan, limits));

    expect(error.message.split('\n').sort()).toEqual(
      [
        'limits.other is a key BrokerLimits does not define',
        'limits.streamDefaults.maxage is a key BrokerLimits does not define',
        'limits.durableConsumerDefaults.backoff is a key BrokerLimits does not define',
        `limits.streams.${orders.stream}.replica is a key BrokerLimits does not define`,
      ].sort(),
    );
    expect(service.opened).toHaveLength(0);
  });

  test('applyBrokerPlan refuses a setting name limits does not know even when its value is undefined', async () => {
    const prefix = aPrefix();
    const service = aConnect();
    const connecting = { connect: service.connect };
    const limits = {
      ...testLimits,
      streamDefaults: { ...testLimits.streamDefaults, maxBytes: undefined },
    } as BrokerLimits;

    const error = await rejectionOf(applyBrokerPlan(connecting, anOrders(prefix).plan, limits));

    expect(error.message).toBe(
      'limits.streamDefaults.maxBytes is a key BrokerLimits does not define',
    );
    expect(service.opened).toHaveLength(0);
  });

  test('applyBrokerPlan refuses a limit keyed by a name the plan does not list, naming each', async () => {
    const prefix = aPrefix();
    const orders = anOrders(prefix);
    const service = aConnect();
    const connecting = { connect: service.connect };
    const limits: BrokerLimits = {
      ...testLimits,
      streams: { [`${prefix}_ordres-service`]: { replicas: 1 } },
      durableConsumers: { [`${prefix}_orders-service_command_ChargeCard_v2`]: { ackWait: '2m' } },
    };

    const error = await rejectionOf(applyBrokerPlan(connecting, orders.plan, limits));

    expect(error.message).toBe(
      [
        `limits.streams names ${prefix}_ordres-service, which the plan does not list`,
        `limits.durableConsumers names ${prefix}_orders-service_command_ChargeCard_v2, which the plan does not list`,
      ].join('\n'),
    );
    expect(service.opened).toHaveLength(0);
  });
});

describe('the connection applyBrokerPlan uses', () => {
  test('applyBrokerPlan calls the Service’s connect once and drains that connection when it succeeds', async () => {
    const prefix = aPrefix();
    const service = aConnect();
    const connecting = { connect: service.connect };
    const connectedBefore = service.opened.length;

    await applyBrokerPlan(connecting, anOrders(prefix).plan, testLimits);

    expect(connectedBefore).toBe(0);
    expect(service.opened.map((connection) => connection.isClosed())).toEqual([true]);
  });

  test('applyBrokerPlan drains the connection when NATS refuses', async () => {
    const prefix = aPrefix();
    const orders = anOrders(prefix);
    await arrangeStream(
      server.url,
      { name: orders.stream, subjects: [orders.charge, orders.created] },
      { storage: 'memory' },
    );
    const service = aConnect();
    const connecting = { connect: service.connect };

    const error = await rejectionOf(applyBrokerPlan(connecting, orders.plan, testLimits));

    expect(error.cause).toBeInstanceOf(JetStreamApiError);
    expect(service.opened.map((connection) => connection.isClosed())).toEqual([true]);
  });

  test('applyBrokerPlan drains the connection when it refuses a Durable consumer whose stream does not exist', async () => {
    const prefix = aPrefix();
    const service = aConnect();
    const connecting = { connect: service.connect };

    await rejectionOf(applyBrokerPlan(connecting, aBilling(prefix).plan, testLimits));

    expect(service.opened.map((connection) => connection.isClosed())).toEqual([true]);
  });

  test.each([
    ['keeps reconnecting', -1],
    ['gives up reconnecting after one attempt', 1],
  ])(
    'applyBrokerPlan, when the server goes away before its drain after applying everything and the Service’s connect %s, closes its connection and rejects saying NATS did not answer the drain, with nats.js’s error as its cause',
    async (_reconnecting, maxReconnectAttempts) => {
      const prefix = aPrefix();
      const own = await aNatsServer();
      onTestFinished(() => own.stop());
      const opened: NatsConnection[] = [];
      const connectLosingServerAtDrain = async (): Promise<NatsConnection> => {
        const connection = await connect({
          servers: own.url,
          maxReconnectAttempts,
          reconnectTimeWait: 200,
        });
        onTestFinished(() => connection.close());
        opened.push(connection);
        const drain = async () => {
          await stopServerUnder(connection, own);
          return await connection.drain();
        };
        return withMethods(connection, { drain });
      };
      const connecting = { connect: connectLosingServerAtDrain };

      const error = await rejectionOf(
        applyBrokerPlan(connecting, anOrders(prefix).plan, testLimits),
      );

      expect(error.message).toBe(
        'NATS did not answer the drain, so the connection was closed without it',
      );
      expect(error.cause).toBeInstanceOf(Error);
      expect(opened.map((connection) => connection.isClosed())).toEqual([true]);
    },
  );

  test('applyBrokerPlan, when its JetStream manager cannot be made and the drain is not answered either, rejects with that error unchanged and closes its connection', async () => {
    const prefix = aPrefix();
    const opened: NatsConnection[] = [];
    const connectUndrainable = async (): Promise<NatsConnection> => {
      const connection = await connect({ servers: server.url });
      onTestFinished(() => connection.close());
      opened.push(connection);
      return withMethods(connection, { drain: () => Promise.reject(new Error('no answer')) });
    };
    const connecting = { connect: connectUndrainable, jetstream: { apiPrefix: '' } };

    const error = await rejectionOf(applyBrokerPlan(connecting, anOrders(prefix).plan, testLimits));

    expect(error.message).toBe("'prefix' cannot be empty");
    expect(opened.map((connection) => connection.isClosed())).toEqual([true]);
  });

  test('applyBrokerPlan, when applying fails and the drain is not answered either, rejects naming the stream it could not apply, with the client’s error as its cause, and closes its connection', async () => {
    const prefix = aPrefix();
    const orders = anOrders(prefix);
    const own = await aNatsServer();
    onTestFinished(() => own.stop());
    const opened: NatsConnection[] = [];
    const connectToGoneServer = async (): Promise<NatsConnection> => {
      const connection = await connect({
        servers: own.url,
        maxReconnectAttempts: -1,
        reconnectTimeWait: 200,
      });
      onTestFinished(() => connection.close());
      opened.push(connection);
      await stopServerUnder(connection, own);
      return connection;
    };
    const connecting = { connect: connectToGoneServer, jetstream: { timeout: 500 } };

    const error = await rejectionOf(applyBrokerPlan(connecting, orders.plan, testLimits));

    expect(error.message).toContain(`The stream ${orders.stream} could not be applied: `);
    expect(error.cause).toBeInstanceOf(Error);
    expect(opened.map((connection) => connection.isClosed())).toEqual([true]);
  });

  test('applyBrokerPlan rejects with the error the Service’s connect rejected with', async () => {
    const prefix = aPrefix();
    const error = new Error('no route to NATS');
    const connecting = { connect: () => Promise.reject(error) };

    const applying = applyBrokerPlan(connecting, anOrders(prefix).plan, testLimits);

    await expect(applying).rejects.toBe(error);
  });

  test('a failure of the NATS client while applying a stream rejects applyBrokerPlan naming the stream, with the client’s error as its cause', async () => {
    const prefix = aPrefix();
    const orders = anOrders(prefix);
    const clientError = new Error('the Broker did not answer');
    const connectFailing = async () => {
      const connection = await connect({ servers: server.url });
      onTestFinished(() => connection.close());
      return withMethods(connection, { request: () => Promise.reject(clientError) });
    };
    const connecting = { connect: connectFailing };

    const error = await rejectionOf(applyBrokerPlan(connecting, orders.plan, testLimits));

    expect(error.message).toBe(
      `The stream ${orders.stream} could not be applied: the Broker did not answer`,
    );
    expect(error.cause).toBe(clientError);
  });

  test('the jetstream options reach applyBrokerPlan: an unknown domain rejects applyBrokerPlan naming the first stream, with the client’s error as its cause', async () => {
    const prefix = aPrefix();
    const orders = anOrders(prefix);
    const service = aConnect();
    const connecting = { connect: service.connect, jetstream: { domain: 'nowhere' } };

    const error = await rejectionOf(applyBrokerPlan(connecting, orders.plan, testLimits));

    expect(error.message).toContain(`The stream ${orders.stream} could not be applied: `);
    expect(error.message).toContain('jetstream is not enabled');
    expect(error.cause).toBeInstanceOf(Error);
  });

  test('a Service started with jetstream({ prefix }) finds the Stream applyBrokerPlan created from the plan with that prefix', async () => {
    const prefix = aPrefix();
    const plan = JSON.parse(JSON.stringify(planOf(contract, prefix)));
    await applyBrokerPlan({ connect: aConnect().connect }, plan, testLimits);

    const opening = messaging(contract, jetstream({ connect: aConnect().connect, prefix }));

    await expect(opening).resolves.toBeDefined();
  });
});
