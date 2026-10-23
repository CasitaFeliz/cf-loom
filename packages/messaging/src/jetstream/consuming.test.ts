// biome-ignore-all lint/style/useNamingConvention: nats.js spells its settings in snake case
import {
  type ContractPackage,
  defineCommand,
  defineContract,
  defineDependencies,
  defineEvent,
  defineSubscription,
} from '@cf-loom/contract';
import { type Fault, handle, type MessageMeta, withReader } from '@cf-loom/handlers';
import type { NatsConnection } from '@nats-io/nats-core';
import { connect } from '@nats-io/transport-node';
import { afterAll, afterEach, beforeAll, describe, expect, onTestFinished, test, vi } from 'vitest';
import { z } from 'zod';
import { arrangeDurable, arrangeDurablesOf, durableInfoOf } from '../../test/durables.ts';
import { aNatsServer, type NatsServer } from '../../test/nats-server.ts';
import { arrangePlanOf, dropStream, planOf } from '../../test/streams.ts';
import { type Messaging, messaging } from '../index.ts';
import { type BrokerPlan, jetstream } from './index.ts';

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

const notifyOnCreated = defineSubscription({ name: 'notify-on-created', event: orderCreatedV1 });

const contract = defineContract({
  name: 'orders-service',
  events: [orderCreatedV1],
  commands: [chargeCardV1],
  subscriptions: [notifyOnCreated],
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
  return `c-${tests}`;
}

/** The Service’s own `connect`: opens a connection to the test server and closes it when the test ends. */
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

/** Orders’ names under a prefix: its stream, its subjects and its two durable consumers. */
function anOrders(prefix: string) {
  return {
    stream: `${prefix}_orders-service`,
    created: `${prefix}.orders-service.event.OrderCreated.v1`,
    charge: `${prefix}.orders-service.command.ChargeCard.v1`,
    notifyDurable: `${prefix}_orders-service_notify-on-created`,
    chargeDurable: `${prefix}_orders-service_command_ChargeCard_v1`,
  };
}

type Orders = ReturnType<typeof anOrders>;

type Received = { readonly handler: string; readonly body: unknown; readonly meta: MessageMeta };

type Behavior = (received: Received) => Promise<Fault | undefined> | Fault | undefined;

/** The Handler map of Orders, each Handler recording what it receives and then doing as the behavior says. */
function handlersOf(
  received: Received[],
  behaviors: { notify?: Behavior; charge?: Behavior } = {},
) {
  const recording = (handler: string, behavior: Behavior | undefined) => {
    return async (body: unknown, meta: MessageMeta): Promise<Fault | undefined> => {
      const entry = { handler, body, meta };
      received.push(entry);
      return await behavior?.(entry);
    };
  };
  return {
    commands: {
      chargeCardV1: handle(
        withReader(chargeCardV1, orderBody),
        recording('ChargeCard@1', behaviors.charge),
      ),
    },
    subscriptions: {
      'notify-on-created': handle(
        withReader(notifyOnCreated, orderBody),
        recording('notify-on-created', behaviors.notify),
      ),
    },
  };
}

/** A messaging over `jetstream()` on the test server, closed when the test ends. */
async function aMessaging(prefix: string): Promise<Messaging<typeof contract>> {
  const broker = jetstream({ connect: aConnect().connect, prefix });
  const opened = await messaging(contract, broker, { onServiceFault: () => undefined });
  onTestFinished(() => opened.close());
  return opened;
}

/** Orders’ streams and durable consumers on the test server, as the organization’s tooling would arrange them. */
async function arrangeOrders(prefix: string): Promise<void> {
  await arrangePlanOf(server.url, contract, prefix);
  await arrangeDurablesOf(server.url, planOf(contract, prefix));
}

/** The plan with only the durable consumers named kept, to arrange some of Orders’ durable consumers and not others. */
function onlyDurablesOf(plan: BrokerPlan, ...names: readonly string[]): BrokerPlan {
  const kept = Object.entries(plan.consumers).filter(([name]) => names.includes(name));
  return { ...plan, consumers: Object.fromEntries(kept) };
}

/** Waits for what a test expects not to happen: the window in which it would have. */
function aWhile(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 300));
}

const apply = "apply the Service's broker plan";

afterEach(() => {
  vi.restoreAllMocks();
});

describe('consuming over jetstream()', () => {
  test('consume binds each Subscription and Command Version to its prefixed durable consumer, and a Message published before or after it reaches its Handler', async () => {
    const prefix = aPrefix();
    await arrangeOrders(prefix);
    const received: Received[] = [];
    const orders = await aMessaging(prefix);
    await orders.sender.send('ChargeCard', { orderId: 'o-1' });

    await orders.consume(handlersOf(received));
    await orders.publisher.publish('OrderCreated', { v1: { orderId: 'o-2' } });

    await vi.waitFor(() => expect(received).toHaveLength(2));
    expect(received.map(({ handler, body }) => ({ handler, body }))).toEqual(
      expect.arrayContaining([
        { handler: 'ChargeCard@1', body: { orderId: 'o-1' } },
        { handler: 'notify-on-created', body: { orderId: 'o-2' } },
      ]),
    );
  });

  test('consume rejects naming each durable consumer that does not exist and the stream it reads, and pulls from none', async () => {
    const prefix = aPrefix();
    const orders = anOrders(prefix);
    await arrangePlanOf(server.url, contract, prefix);
    const plan = planOf(contract, prefix);
    await arrangeDurablesOf(server.url, onlyDurablesOf(plan, orders.notifyDurable));
    const received: Received[] = [];
    const messagingOfOrders = await aMessaging(prefix);
    await messagingOfOrders.publisher.publish('OrderCreated', { v1: { orderId: 'o-1' } });

    const consuming = messagingOfOrders.consume(handlersOf(received));

    await expect(consuming).rejects.toThrow(
      `The durable consumer ${orders.chargeDurable} does not exist on the stream ${orders.stream}: ${apply}`,
    );
    await aWhile();
    const info = await durableInfoOf(server.url, orders.stream, orders.notifyDurable);
    expect(received).toEqual([]);
    expect(info).toMatchObject({ num_pending: 1, num_waiting: 0, delivered: { consumer_seq: 0 } });
  });

  test('consume rejects naming every durable consumer that does not exist', async () => {
    const prefix = aPrefix();
    const orders = anOrders(prefix);
    await arrangePlanOf(server.url, contract, prefix);
    const messagingOfOrders = await aMessaging(prefix);

    const consuming = messagingOfOrders.consume(handlersOf([]));

    const error = await consuming.catch((rejected: unknown) => rejected);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message.split('\n').sort()).toEqual([
      `The durable consumer ${orders.chargeDurable} does not exist on the stream ${orders.stream}: ${apply}`,
      `The durable consumer ${orders.notifyDurable} does not exist on the stream ${orders.stream}: ${apply}`,
    ]);
  });

  test('consume called again once the missing durable consumer exists starts consuming', async () => {
    const prefix = aPrefix();
    const orders = anOrders(prefix);
    await arrangePlanOf(server.url, contract, prefix);
    const plan = planOf(contract, prefix);
    await arrangeDurablesOf(server.url, onlyDurablesOf(plan, orders.notifyDurable));
    const received: Received[] = [];
    const messagingOfOrders = await aMessaging(prefix);
    await messagingOfOrders.publisher.publish('OrderCreated', { v1: { orderId: 'o-1' } });
    await messagingOfOrders.sender.send('ChargeCard', { orderId: 'o-2' });
    await messagingOfOrders.consume(handlersOf(received)).catch(() => undefined);
    await arrangeDurablesOf(server.url, onlyDurablesOf(plan, orders.chargeDurable));

    await messagingOfOrders.consume(handlersOf(received));

    await vi.waitFor(() => expect(received).toHaveLength(2));
    expect(received.map(({ handler }) => handler).sort()).toEqual([
      'ChargeCard@1',
      'notify-on-created',
    ]);
  });

  test('consume rejects naming the stream when the stream a durable consumer reads does not exist', async () => {
    const prefix = aPrefix();
    const orders = anOrders(prefix);
    await arrangeOrders(prefix);
    const messagingOfOrders = await aMessaging(prefix);
    await dropStream(server.url, orders.stream);

    const consuming = messagingOfOrders.consume(handlersOf([]));

    await expect(consuming).rejects.toThrow(
      `The stream ${orders.stream}, which the durable consumer ${orders.notifyDurable} reads, does not exist: ${apply}`,
    );
  });

  test.each([
    [
      'a push consumer',
      (orders: Orders) => ({
        ack_policy: 'explicit' as const,
        filter_subject: orders.created,
        deliver_subject: 'somewhere.else',
      }),
      () => 'is a push consumer, not a pull consumer',
    ],
    [
      'one that does not acknowledge explicitly',
      (orders: Orders) => ({ ack_policy: 'none' as const, filter_subject: orders.created }),
      () => 'has the ack policy none, not explicit',
    ],
    [
      'one filtered on another subject',
      (orders: Orders) => ({
        ack_policy: 'explicit' as const,
        filter_subject: `${orders.created}.other`,
      }),
      (orders: Orders) => `filters ${orders.created}.other, not ${orders.created}`,
    ],
    [
      'one filtered on no subject',
      () => ({ ack_policy: 'explicit' as const }),
      (orders: Orders) => `filters every subject, not ${orders.created}`,
    ],
  ])(
    'consume refuses %s, naming the durable consumer and what differs',
    async (_name, config, difference) => {
      const prefix = aPrefix();
      const orders = anOrders(prefix);
      await arrangePlanOf(server.url, contract, prefix);
      const plan = planOf(contract, prefix);
      await arrangeDurablesOf(server.url, onlyDurablesOf(plan, orders.chargeDurable));
      await arrangeDurable(server.url, orders.stream, {
        ...config(orders),
        durable_name: orders.notifyDurable,
      });
      const messagingOfOrders = await aMessaging(prefix);

      const consuming = messagingOfOrders.consume(handlersOf([]));

      await expect(consuming).rejects.toThrow(
        `The durable consumer ${orders.notifyDurable} ${difference(orders)}: ${apply}`,
      );
    },
  );

  test('consume binds a durable consumer that filters on its subject through filter_subjects', async () => {
    const prefix = aPrefix();
    const orders = anOrders(prefix);
    await arrangePlanOf(server.url, contract, prefix);
    const plan = planOf(contract, prefix);
    await arrangeDurablesOf(server.url, onlyDurablesOf(plan, orders.chargeDurable));
    await arrangeDurable(server.url, orders.stream, {
      ack_policy: 'explicit',
      filter_subjects: [orders.created],
      durable_name: orders.notifyDurable,
    });
    const messagingOfOrders = await aMessaging(prefix);

    const consuming = messagingOfOrders.consume(handlersOf([]));

    await expect(consuming).resolves.toBeUndefined();
  });

  test('a stub’s durable consumer is not needed: consume binds only the Handlers it pulls', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const prefix = aPrefix();
    const orders = anOrders(prefix);
    await arrangePlanOf(server.url, contract, prefix);
    const plan = planOf(contract, prefix);
    await arrangeDurablesOf(server.url, onlyDurablesOf(plan, orders.notifyDurable));
    const received: Received[] = [];
    const messagingOfOrders = await aMessaging(prefix);
    const handlers = {
      ...handlersOf(received),
      commands: { chargeCardV1: handle.stub(withReader(chargeCardV1, orderBody)) },
    };

    await messagingOfOrders.consume(handlers);
    await messagingOfOrders.publisher.publish('OrderCreated', { v1: { orderId: 'o-1' } });

    await vi.waitFor(() =>
      expect(received.map(({ handler }) => handler)).toEqual(['notify-on-created']),
    );
  });

  test('without a prefix, consume binds the unprefixed durable consumer names', async () => {
    const unprefixed = defineContract({
      name: 'unprefixed-service',
      events: [orderCreatedV1],
      subscriptions: [notifyOnCreated],
    });
    await arrangePlanOf(server.url, unprefixed, null);
    await arrangeDurablesOf(server.url, planOf(unprefixed, null));
    const received: Received[] = [];
    const opened = await messaging(unprefixed, jetstream({ connect: aConnect().connect }));
    onTestFinished(() => opened.close());

    await opened.consume(handlersOf(received));
    await opened.publisher.publish('OrderCreated', { v1: { orderId: 'o-1' } });

    await vi.waitFor(() => expect(received).toHaveLength(1));
    const info = await durableInfoOf(
      server.url,
      'unprefixed-service',
      'unprefixed-service_notify-on-created',
    );
    expect(info?.config.filter_subject).toBe('unprefixed-service.event.OrderCreated.v1');
  });

  test('the jetstream options reach consume: an unknown domain rejects it with the client’s error', async () => {
    const paymentSettledV1 = defineEvent({
      name: 'PaymentSettled',
      version: 1,
      visibility: 'internal',
      description: 'A payment was settled',
      body: z.object({ paymentId: z.string() }),
    });
    const payments = {
      name: 'payments-service',
      version: '5.1.0',
      endpoints: {},
      events: { paymentSettledV1 },
      standardRejections: {
        invalidInput: { code: 'INVALID_INPUT', status: 400, message: 'Invalid input' },
        notFound: { code: 'NOT_FOUND', status: 404, message: 'Not found' },
        notImplemented: { code: 'NOT_IMPLEMENTED', status: 501, message: 'Not implemented' },
      },
      exportedSnapshot: { format: 1, defs: {}, endpoints: {}, events: {}, guards: {}, codes: {} },
    } as const satisfies ContractPackage;
    const notifyOnSettled = defineSubscription({
      name: 'notify-on-settled',
      event: paymentSettledV1,
    });
    const billing = defineContract({
      name: 'billing-service',
      subscriptions: [notifyOnSettled],
      dependencies: [defineDependencies(payments, { events: [paymentSettledV1] })],
    });
    const broker = jetstream({
      connect: aConnect().connect,
      prefix: aPrefix(),
      jetstream: { domain: 'nowhere' },
    });
    const opened = await messaging(billing, broker, { onServiceFault: () => undefined });
    onTestFinished(() => opened.close());
    const handlers = {
      commands: {},
      subscriptions: {
        'notify-on-settled': handle(
          withReader(notifyOnSettled, paymentSettledV1.body),
          () => undefined,
        ),
      },
    };

    const consuming = opened.consume(handlers);

    await expect(consuming).rejects.toThrow('jetstream is not enabled');
  });
});
