// biome-ignore-all lint/style/useNamingConvention: nats.js spells its settings in snake case

import { setTimeout as sleep } from 'node:timers/promises';
import {
  type ContractPackage,
  defineCommand,
  defineContract,
  defineDependency,
  defineEvent,
  defineGroup,
  defineSubscription,
} from '@cf-loom/contract';
import { fault, handle, type MessageFault, type MessageMeta, readersOf } from '@cf-loom/handlers';
import { type ConsumerConfig, jetstream as jetStreamClientOf } from '@nats-io/jetstream';
import { headers, type NatsConnection, type Subscription } from '@nats-io/nats-core';
import { connect } from '@nats-io/transport-node';
import { afterAll, afterEach, beforeAll, describe, expect, onTestFinished, test, vi } from 'vitest';
import { z } from 'zod';
import { withMethods } from '../../test/connections.ts';
import {
  arrangeDurable,
  arrangeDurablesOf,
  dropDurable,
  durableInfoOf,
} from '../../test/durables.ts';
import { aHoldingProxy } from '../../test/holding-proxy.ts';
import { aNatsServer, type NatsServer } from '../../test/nats-server.ts';
import { providedStandardRejections } from '../../test/standard-rejections.ts';
import { arrangePlanOf, dropStream, planOf } from '../../test/streams.ts';
import { type ConsumedFault, messaging } from '../index.ts';
import { memory } from '../memory/index.ts';
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

const notifyOnCreated = defineSubscription({
  name: 'notifyOnCreated',
  description: 'Notify on created',
  event: orderCreatedV1,
});

const contract = defineContract({
  name: 'orders-service',
  groups: [
    defineGroup({
      name: 'messages',
      description: 'Messages',
      events: [orderCreatedV1],
      commands: [chargeCardV1],
      subscriptions: [notifyOnCreated],
    }),
  ],
});

const readers = readersOf({
  commands: { chargeCardV1: { element: chargeCardV1, reader: orderBody } },
  subscriptions: { notifyOnCreated: { element: notifyOnCreated, reader: orderBody } },
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

/** The Service’s own `connect`: opens a connection to the test server, with the methods `replacing` gives, and closes it when the test ends. */
function aConnect(replacing?: Replacing, servers: string = server.url, inboxPrefix?: string) {
  const opened: NatsConnection[] = [];
  const connectService = async (): Promise<NatsConnection> => {
    const connection = await connect({
      servers,
      ...(inboxPrefix === undefined ? {} : { inboxPrefix }),
    });
    opened.push(connection);
    onTestFinished(() => connection.close());
    return replacing === undefined ? connection : withMethods(connection, replacing(connection));
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

/** The methods of a NATS connection a test replaces, given the connection they are replaced on. */
type Replacing = (connection: NatsConnection) => Partial<NatsConnection>;

type Orders = ReturnType<typeof anOrders>;

type Received = { readonly handler: string; readonly body: unknown; readonly meta: MessageMeta };

type Behavior = (
  received: Received,
) => Promise<MessageFault | undefined> | MessageFault | undefined;

/** The Handler map of Orders, each Handler recording what it receives and then doing as the behavior says. */
function handlersOf(
  received: Received[],
  behaviors: { notify?: Behavior; charge?: Behavior } = {},
) {
  const recording = (handler: string, behavior: Behavior | undefined) => {
    return async (body: unknown, meta: MessageMeta): Promise<MessageFault | undefined> => {
      const entry = { handler, body, meta };
      received.push(entry);
      return await behavior?.(entry);
    };
  };
  return {
    commands: {
      chargeCardV1: handle(
        readers.commands.chargeCardV1,
        recording('ChargeCard@1', behaviors.charge),
      ),
    },
    subscriptions: {
      notifyOnCreated: handle(
        readers.subscriptions.notifyOnCreated,
        recording('notifyOnCreated', behaviors.notify),
      ),
    },
    readers,
  };
}

/** A messaging over `jetstream()` on the test server, closed when the test ends, with the connection it opened. */
async function aMessaging(
  prefix: string,
  settings: {
    readonly onServiceFault?: (fault: ConsumedFault) => void | Promise<void>;
    readonly replacing?: Replacing;
    readonly servers?: string;
    readonly inboxPrefix?: string;
  } = {},
) {
  const service = aConnect(settings.replacing, settings.servers, settings.inboxPrefix);
  const broker = jetstream({ connect: service.connect, prefix });
  const onServiceFault = settings.onServiceFault ?? (() => undefined);
  const opened = await messaging(contract, broker, { onServiceFault });
  onTestFinished(() => opened.close());
  return { ...opened, connections: service.opened };
}

/** Orders’ streams and durable consumers on the test server, as the organization’s tooling would arrange them, with `settings` over theirs. */
async function arrangeOrders(
  prefix: string,
  settings: Partial<ConsumerConfig> = {},
): Promise<void> {
  await arrangePlanOf(server.url, contract, prefix);
  await arrangeDurablesOf(server.url, planOf(contract, prefix), settings);
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

/** Publishes a Message the way a publisher other than cf-loom would: exactly these headers, a name given twice kept twice. */
async function publishRaw(
  subject: string,
  body: unknown,
  entries: readonly (readonly [string, string])[],
): Promise<void> {
  const connection = await connect({ servers: server.url });
  try {
    const raw = headers();
    for (const [name, value] of entries) {
      raw.append(name, value);
    }
    await jetStreamClientOf(connection).publish(subject, JSON.stringify(body), { headers: raw });
  } finally {
    await connection.close();
  }
}

/** The reasons of the Messages the Broker's advisories say were terminated, collected from now on. */
async function terminationsOf(): Promise<string[]> {
  const connection = await connect({ servers: server.url });
  onTestFinished(() => connection.close());
  const reasons: string[] = [];
  const advisories = connection.subscribe('$JS.EVENT.ADVISORY.CONSUMER.MSG_TERMINATED.>');
  void (async () => {
    for await (const advisory of advisories) {
      reasons.push(advisory.json<{ reason: string }>().reason);
    }
  })();
  await connection.flush();
  return reasons;
}

/** Waits for the durable consumer to hold nothing pending and nothing awaiting acknowledgement after `delivered` deliveries. */
async function waitUntilSettled(stream: string, durable: string, delivered: number): Promise<void> {
  await vi.waitFor(
    async () => {
      const info = await durableInfoOf(server.url, stream, durable);
      expect(info).toMatchObject({
        num_pending: 0,
        num_ack_pending: 0,
        delivered: { consumer_seq: delivered },
      });
    },
    { timeout: 8_000 },
  );
}

const oneSecond = 1_000_000_000;

/** A request for a Message a durable consumer is pulled with: its subject, how long it waits in nanoseconds, and when it was sent. */
type RecordedPull = { readonly subject: string; readonly expires: number; readonly at: number };

/** The methods of a NATS connection that record each request for a Message a durable consumer is pulled with. */
function recordingPulls(pulls: RecordedPull[]): Replacing {
  return (connection) => ({
    publish: (subject, data, options) => {
      if (subject.includes('.CONSUMER.MSG.NEXT.')) {
        const text = typeof data === 'string' ? data : new TextDecoder().decode(data);
        pulls.push({ subject, expires: JSON.parse(text).expires, at: Date.now() });
      }
      connection.publish(subject, data, options);
    },
  });
}

/** How many timers this process has running, to say none outlives what a test closed. */
function activeTimers(): number {
  return process.getActiveResourcesInfo().filter((resource) => resource === 'Timeout').length;
}

/** A consuming messaging whose durable consumers were deleted, with its pulls failing and each loop waiting out its retry pause. */
async function aConsumingWithFailingPulls(prefix: string) {
  const names = anOrders(prefix);
  await arrangeOrders(prefix);
  const pulls: RecordedPull[] = [];
  const orders = await aMessaging(prefix, { replacing: recordingPulls(pulls) });
  await orders.consume(handlersOf([]));
  await dropDurable(server.url, names.stream, names.notifyDurable);
  await dropDurable(server.url, names.stream, names.chargeDurable);
  const pulledBefore = pulls.length;
  await vi.waitFor(() => expect(pulls.length).toBeGreaterThanOrEqual(pulledBefore + 2), {
    timeout: 4_000,
  });
  await sleep(150);
  return orders;
}

/** A promise a test settles itself, to hold a Handler while it runs; opened when the test ends, so a failing test never leaves a Handler held. */
function aGate() {
  const gate = Promise.withResolvers<undefined>();
  const open = () => gate.resolve(undefined);
  onTestFinished(open);
  return { opened: gate.promise, open };
}

/** Waits until the durable consumer has a pull open on the Broker, so a Message published now is delivered at once. */
async function waitUntilPulling(stream: string, durable: string): Promise<void> {
  await vi.waitFor(async () => {
    const info = await durableInfoOf(server.url, stream, durable);
    expect(info?.num_waiting).toBe(1);
  });
}

/** Spies on every console method, so a test can say the adapter wrote nothing. */
function spiesOnConsole() {
  return (['debug', 'error', 'info', 'log', 'warn'] as const).map((method) => {
    return vi.spyOn(console, method).mockImplementation(() => undefined);
  });
}

describe('consuming over jetstream()', () => {
  test('consume finds the prefixed durable consumer of each Subscription and Command Version, and a Message published before or after it reaches its Handler', async () => {
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
        { handler: 'notifyOnCreated', body: { orderId: 'o-2' } },
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
      'notifyOnCreated',
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

  test('consume accepts a durable consumer that filters on its subject through filter_subjects', async () => {
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

  test('a stub’s durable consumer is not needed: consume looks only for the durable consumers of the Handlers it pulls', async () => {
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
      commands: { chargeCardV1: handle.stub(readers.commands.chargeCardV1) },
    };

    await messagingOfOrders.consume(handlers);
    await messagingOfOrders.publisher.publish('OrderCreated', { v1: { orderId: 'o-1' } });

    await vi.waitFor(() =>
      expect(received.map(({ handler }) => handler)).toEqual(['notifyOnCreated']),
    );
  });

  test('without a prefix, consume looks for the unprefixed durable consumer names', async () => {
    const unprefixed = defineContract({
      name: 'unprefixed-service',
      groups: [
        defineGroup({
          name: 'messages',
          description: 'Messages',
          events: [orderCreatedV1],
          subscriptions: [notifyOnCreated],
        }),
      ],
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
      standardRejections: providedStandardRejections(),
      exportedSnapshot: { format: 1, defs: {}, endpoints: {}, events: {}, guards: {}, codes: {} },
    } as const satisfies ContractPackage;
    const notifyOnSettled = defineSubscription({
      name: 'notifyOnSettled',
      description: 'Notify on settled',
      event: paymentSettledV1,
    });
    const billing = defineContract({
      name: 'billing-service',
      groups: [
        defineGroup({
          name: 'messages',
          description: 'Messages',
          subscriptions: [notifyOnSettled],
        }),
      ],
      dependencies: [defineDependency({ provider: payments })],
    });
    const broker = jetstream({
      connect: aConnect().connect,
      prefix: aPrefix(),
      jetstream: { domain: 'nowhere' },
    });
    const opened = await messaging(billing, broker, { onServiceFault: () => undefined });
    onTestFinished(() => opened.close());
    const billingReaders = readersOf({
      commands: {},
      subscriptions: {
        notifyOnSettled: { element: notifyOnSettled, reader: paymentSettledV1.body },
      },
    });
    const handlers = {
      commands: {},
      subscriptions: {
        notifyOnSettled: handle(billingReaders.subscriptions.notifyOnSettled, () => undefined),
      },
      readers: billingReaders,
    };

    const consuming = opened.consume(handlers);

    await expect(consuming).rejects.toThrow('jetstream is not enabled');
  });

  test('the Handler receives the Message’s broker message id, Fact id, delivery count 1 and transport headers, without cf-loom’s own', async () => {
    const prefix = aPrefix();
    await arrangeOrders(prefix);
    const received: Received[] = [];
    const orders = await aMessaging(prefix);
    await orders.consume(handlersOf(received));

    await orders.publisher.publish(
      'OrderCreated',
      { v1: { orderId: 'o-1' } },
      { factId: 'o-1:created', headers: { traceparent: '00-abc-def-01' } },
    );

    await vi.waitFor(() => expect(received).toHaveLength(1));
    expect(received[0]?.meta).toEqual({
      messageId: 'event.OrderCreated.v1:o-1:created',
      factId: 'o-1:created',
      deliveryCount: 1,
      headers: { traceparent: '00-abc-def-01' },
    });
  });

  test('a Fact id and transport headers the rule lets through reach the Handler as given, over jetstream() as over memory()', async () => {
    const given = {
      factId: 'pedido ñ\t1',
      headers: {
        'x-note': 'café  con\tleche',
        'x-empty': '',
        'x-ctl': 'a\u0001b',
        'x-text': '日本 🎉',
        traceparent: 'A',
        Traceparent: 'B',
      },
    };
    const prefix = aPrefix();
    await arrangeOrders(prefix);
    const overJetstream: Received[] = [];
    const orders = await aMessaging(prefix);
    await orders.consume(handlersOf(overJetstream));
    const overMemory: Received[] = [];
    const inMemory = await messaging(contract, memory());
    onTestFinished(() => inMemory.close());
    await inMemory.consume(handlersOf(overMemory));

    await orders.publisher.publish('OrderCreated', { v1: { orderId: 'o-1' } }, given);
    await inMemory.publisher.publish('OrderCreated', { v1: { orderId: 'o-1' } }, given);

    await vi.waitFor(() => expect(overJetstream).toHaveLength(1));
    await vi.waitFor(() => expect(overMemory).toHaveLength(1));
    const seenOf = (received: Received[]) => {
      return { factId: received[0]?.meta.factId, headers: received[0]?.meta.headers };
    };
    expect(seenOf(overJetstream)).toEqual(given);
    expect(seenOf(overMemory)).toEqual(given);
  });

  test('a Message whose broker headers take exactly the bytes JetStream stores reaches the Handler with its Fact id and transport headers as given, over jetstream() as over memory()', async () => {
    const given = { factId: 'o-1', headers: { 'x-pad': 'p'.repeat(65_452) } };
    const prefix = aPrefix();
    await arrangeOrders(prefix);
    const overJetstream: Received[] = [];
    const orders = await aMessaging(prefix);
    await orders.consume(handlersOf(overJetstream));
    const overMemory: Received[] = [];
    const inMemory = await messaging(contract, memory());
    onTestFinished(() => inMemory.close());
    await inMemory.consume(handlersOf(overMemory));

    await orders.publisher.publish('OrderCreated', { v1: { orderId: 'o-1' } }, given);
    await inMemory.publisher.publish('OrderCreated', { v1: { orderId: 'o-1' } }, given);

    await vi.waitFor(() => expect(overJetstream).toHaveLength(1));
    await vi.waitFor(() => expect(overMemory).toHaveLength(1));
    const seenOf = (received: Received[]) => {
      return { factId: received[0]?.meta.factId, headers: received[0]?.meta.headers };
    };
    expect(seenOf(overJetstream)).toEqual(given);
    expect(seenOf(overMemory)).toEqual(given);
  });

  test('a header published with several values reaches the Handler as its values joined with ", "', async () => {
    const prefix = aPrefix();
    const names = anOrders(prefix);
    await arrangeOrders(prefix);
    const received: Received[] = [];
    const orders = await aMessaging(prefix);
    await orders.consume(handlersOf(received));

    await publishRaw(names.created, { orderId: 'o-1' }, [
      ['Nats-Msg-Id', 'event.OrderCreated.v1:o-1'],
      ['Cf-Loom-Fact-Id', 'o-1'],
      ['tracestate', 'a=1'],
      ['tracestate', 'b=2'],
    ]);

    await vi.waitFor(() => expect(received).toHaveLength(1));
    expect(received[0]?.meta.headers).toEqual({ tracestate: 'a=1, b=2' });
  });

  test.each([
    ['a Cf-Loom-Fact-Id header', [['Nats-Msg-Id', 'm-1']], 'no Cf-Loom-Fact-Id header'],
    ['a Nats-Msg-Id header', [['Cf-Loom-Fact-Id', 'f-1']], 'no Nats-Msg-Id header'],
    [
      'a Cf-Loom-Fact-Id value',
      [
        ['Nats-Msg-Id', 'm-1'],
        ['Cf-Loom-Fact-Id', ''],
      ],
      'no Cf-Loom-Fact-Id header',
    ],
    ['either id header', [], 'no Nats-Msg-Id header, no Cf-Loom-Fact-Id header'],
  ] as const)(
    'a Message without %s is ended without running the Handler, and never comes again',
    async (_name, ids, reason) => {
      const prefix = aPrefix();
      const names = anOrders(prefix);
      await arrangeOrders(prefix);
      const terminated = await terminationsOf();
      const consoleSpies = spiesOnConsole();
      const received: Received[] = [];
      const orders = await aMessaging(prefix);
      await orders.consume(handlersOf(received));

      await publishRaw(names.created, { orderId: 'o-1' }, ids);

      await vi.waitFor(async () => {
        const info = await durableInfoOf(server.url, names.stream, names.notifyDurable);
        expect(info).toMatchObject({
          num_pending: 0,
          num_ack_pending: 0,
          delivered: { consumer_seq: 1 },
        });
      });
      await vi.waitFor(() => expect(terminated).toEqual([reason]));
      expect(received).toEqual([]);
      expect(consoleSpies.map((spy) => spy.mock.calls)).toEqual([[], [], [], [], []]);
    },
  );

  test('returning nothing acknowledges the Message', async () => {
    const prefix = aPrefix();
    const names = anOrders(prefix);
    await arrangeOrders(prefix);
    const received: Received[] = [];
    const orders = await aMessaging(prefix);
    await orders.consume(handlersOf(received));

    await orders.publisher.publish('OrderCreated', { v1: { orderId: 'o-1' } });

    await waitUntilSettled(names.stream, names.notifyDurable, 1);
    const info = await durableInfoOf(server.url, names.stream, names.notifyDurable);
    expect(info?.ack_floor.consumer_seq).toBe(1);
    expect(received).toHaveLength(1);
  });

  test('a Fault that is not retryable ends the Message: it is not delivered again', async () => {
    const prefix = aPrefix();
    const names = anOrders(prefix);
    await arrangeOrders(prefix, { ack_wait: oneSecond });
    const received: Received[] = [];
    const orders = await aMessaging(prefix);
    const failing = () => fault({ committed: 'no', retryable: false, message: 'cannot be done' });
    await orders.consume(handlersOf(received, { notify: failing }));

    await orders.publisher.publish('OrderCreated', { v1: { orderId: 'o-1' } });

    await waitUntilSettled(names.stream, names.notifyDurable, 1);
    expect(received).toHaveLength(1);
  });

  test('a throw leaves the Message unacknowledged, and NATS delivers it again after the ack wait with delivery count 2', async () => {
    const prefix = aPrefix();
    const names = anOrders(prefix);
    await arrangeOrders(prefix, { ack_wait: oneSecond });
    const received: Received[] = [];
    const orders = await aMessaging(prefix);
    const throwingOnce = ({ meta }: Received) => {
      if (meta.deliveryCount === 1) {
        throw new Error('the database is down');
      }
      return undefined;
    };
    await orders.consume(handlersOf(received, { notify: throwingOnce }));

    await orders.publisher.publish('OrderCreated', { v1: { orderId: 'o-1' } });

    await vi.waitFor(() => expect(received).toHaveLength(2), { timeout: 5_000 });
    expect(received.map(({ meta }) => meta.deliveryCount)).toEqual([1, 2]);
    await waitUntilSettled(names.stream, names.notifyDurable, 2);
  }, 10_000);

  test('a receive that rejects, because onServiceFault threw, leaves the Message for redelivery', async () => {
    const prefix = aPrefix();
    await arrangeOrders(prefix, { ack_wait: oneSecond });
    const received: Received[] = [];
    const orders = await aMessaging(prefix, {
      onServiceFault: () => {
        throw new Error('the hook is down');
      },
    });
    const throwingOnce = ({ meta }: Received) => {
      if (meta.deliveryCount === 1) {
        throw new Error('the database is down');
      }
      return undefined;
    };
    await orders.consume(handlersOf(received, { notify: throwingOnce }));

    await orders.publisher.publish('OrderCreated', { v1: { orderId: 'o-1' } });

    await vi.waitFor(() => expect(received).toHaveLength(2), { timeout: 5_000 });
    expect(received.map(({ meta }) => meta.deliveryCount)).toEqual([1, 2]);
  }, 10_000);

  test('a delivery whose onServiceFault throws is logged with the onServiceFault threw line, and redelivered though its Fault would end it', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const prefix = aPrefix();
    await arrangeOrders(prefix, { ack_wait: oneSecond });
    const received: Received[] = [];
    const hook = new Error('the hook is down');
    const orders = await aMessaging(prefix, {
      onServiceFault: async () => Promise.reject(hook),
    });
    const refusingOnce = ({ meta }: Received) => {
      if (meta.deliveryCount === 1) {
        return fault({ committed: 'no', retryable: false });
      }
      return undefined;
    };
    await orders.consume(handlersOf(received, { notify: refusingOnce }));

    await orders.publisher.publish('OrderCreated', { v1: { orderId: 'o-1' } }, { factId: 'o-1' });

    await vi.waitFor(() => expect(received).toHaveLength(2), { timeout: 5_000 });
    expect(received.map(({ meta }) => meta.deliveryCount)).toEqual([1, 2]);
    expect(logged).toHaveBeenCalledWith(
      'notifyOnCreated orders-service.event.OrderCreated.v1 event.OrderCreated.v1:o-1 o-1: onServiceFault threw',
      hook,
    );
  }, 10_000);

  test('a Handler running past the ack wait keeps its Message: another process of the Service is not given it meanwhile', async () => {
    const prefix = aPrefix();
    const names = anOrders(prefix);
    await arrangeOrders(prefix, { ack_wait: oneSecond });
    const received: Received[] = [];
    const slow = () => sleep(2_500).then(() => undefined);
    const processes = [await aMessaging(prefix), await aMessaging(prefix)];
    for (const process of processes) {
      await process.consume(handlersOf(received, { notify: slow }));
    }

    await processes[0]?.publisher.publish('OrderCreated', { v1: { orderId: 'o-1' } });

    await waitUntilSettled(names.stream, names.notifyDurable, 1);
    expect(received).toHaveLength(1);
  }, 10_000);

  test('a durable consumer with a backoff whose later wait is shorter keeps that delivery’s Message too', async () => {
    const prefix = aPrefix();
    const names = anOrders(prefix);
    const waits = [2_400_000_000, 600_000_000];
    await arrangeOrders(prefix, { ack_wait: waits[0] as number, backoff: waits });
    const received: Received[] = [];
    const throwingThenSlow = async ({ meta }: Received) => {
      if (meta.deliveryCount === 1) {
        throw new Error('the database is down');
      }
      await sleep(1_500);
      return undefined;
    };
    const processes = [await aMessaging(prefix), await aMessaging(prefix)];
    for (const process of processes) {
      await process.consume(handlersOf(received, { notify: throwingThenSlow }));
    }

    await processes[0]?.publisher.publish('OrderCreated', { v1: { orderId: 'o-1' } });

    await waitUntilSettled(names.stream, names.notifyDurable, 2);
    expect(received.map(({ meta }) => meta.deliveryCount)).toEqual([1, 2]);
  }, 15_000);

  test('each durable consumer hands its Handler one Message at a time: a second Message waits, unpulled, until the first is settled', async () => {
    const prefix = aPrefix();
    const names = anOrders(prefix);
    await arrangeOrders(prefix);
    const received: Received[] = [];
    const orders = await aMessaging(prefix);
    const firstGate = aGate();
    const holdingTheFirst = ({ body }: Received) => {
      return (body as { orderId: string }).orderId === 'o-1' ? firstGate.opened : undefined;
    };
    await orders.consume(handlersOf(received, { notify: holdingTheFirst }));
    await orders.publisher.publish('OrderCreated', { v1: { orderId: 'o-1' } });
    await orders.publisher.publish('OrderCreated', { v1: { orderId: 'o-2' } });
    await vi.waitFor(() => expect(received).toHaveLength(1));

    await aWhile();
    const whileHeld = await durableInfoOf(server.url, names.stream, names.notifyDurable);
    firstGate.open();

    expect(received).toHaveLength(1);
    expect(whileHeld).toMatchObject({ num_pending: 1, delivered: { consumer_seq: 1 } });
    await waitUntilSettled(names.stream, names.notifyDurable, 2);
    expect(received.map(({ body }) => body)).toEqual([{ orderId: 'o-1' }, { orderId: 'o-2' }]);
  });

  test('the Handlers of two durable consumers run at the same time', async () => {
    const prefix = aPrefix();
    await arrangeOrders(prefix);
    const received: Received[] = [];
    const orders = await aMessaging(prefix);
    const gate = aGate();
    await orders.consume(
      handlersOf(received, { notify: () => gate.opened, charge: () => gate.opened }),
    );

    await orders.publisher.publish('OrderCreated', { v1: { orderId: 'o-1' } });
    await orders.sender.send('ChargeCard', { orderId: 'o-2' });

    await vi.waitFor(() => expect(received).toHaveLength(2));
    gate.open();
  });

  test('a durable consumer deleted and created again while consuming is consumed again, with no new consume', async () => {
    const prefix = aPrefix();
    const names = anOrders(prefix);
    await arrangeOrders(prefix);
    const consoleSpies = spiesOnConsole();
    const received: Received[] = [];
    const orders = await aMessaging(prefix);
    await orders.consume(handlersOf(received));
    await orders.publisher.publish('OrderCreated', { v1: { orderId: 'o-1' } });
    await waitUntilSettled(names.stream, names.notifyDurable, 1);
    await dropDurable(server.url, names.stream, names.notifyDurable);
    await arrangeDurable(server.url, names.stream, {
      durable_name: names.notifyDurable,
      ack_policy: 'explicit',
      filter_subject: names.created,
      deliver_policy: 'new',
    });

    await orders.publisher.publish('OrderCreated', { v1: { orderId: 'o-2' } });

    await vi.waitFor(() => expect(received).toHaveLength(2), { timeout: 6_000 });
    expect(received.map(({ body }) => body)).toEqual([{ orderId: 'o-1' }, { orderId: 'o-2' }]);
    expect(consoleSpies.map((spy) => spy.mock.calls)).toEqual([[], [], [], [], []]);
  }, 10_000);
  test('two fresh Messages on one durable consumer reach the Handler with delivery count 1 each', async () => {
    const prefix = aPrefix();
    await arrangeOrders(prefix);
    const received: Received[] = [];
    const orders = await aMessaging(prefix);
    await orders.consume(handlersOf(received));

    await orders.publisher.publish('OrderCreated', { v1: { orderId: 'o-1' } });
    await orders.publisher.publish('OrderCreated', { v1: { orderId: 'o-2' } });

    await vi.waitFor(() => expect(received).toHaveLength(2));
    expect(received.map(({ meta }) => meta.deliveryCount)).toEqual([1, 1]);
  });

  test('the wait of a second fresh Message is the first entry of the backoff, so a slow Handler keeps it too', async () => {
    const prefix = aPrefix();
    const names = anOrders(prefix);
    const waits = [oneSecond, 6 * oneSecond];
    await arrangeOrders(prefix, { ack_wait: oneSecond, backoff: waits });
    const received: Received[] = [];
    const slowSecond = ({ body }: Received) => {
      return (body as { orderId: string }).orderId === 'o-2'
        ? sleep(2_500).then(() => undefined)
        : undefined;
    };
    const processes = [await aMessaging(prefix), await aMessaging(prefix)];
    for (const process of processes) {
      await process.consume(handlersOf(received, { notify: slowSecond }));
    }

    await processes[0]?.publisher.publish('OrderCreated', { v1: { orderId: 'o-1' } });
    await processes[0]?.publisher.publish('OrderCreated', { v1: { orderId: 'o-2' } });

    await waitUntilSettled(names.stream, names.notifyDurable, 2);
    expect(received.map(({ meta }) => meta.deliveryCount)).toEqual([1, 1]);
  }, 15_000);
});

describe('closing while consuming over jetstream()', () => {
  test('close stops pulling at once: a Message published while a Handler runs is not delivered, and stays pending for the next consumer', async () => {
    const prefix = aPrefix();
    const names = anOrders(prefix);
    await arrangeOrders(prefix);
    const received: Received[] = [];
    const orders = await aMessaging(prefix);
    const gate = aGate();
    await orders.consume(handlersOf(received, { notify: () => gate.opened }));
    await orders.publisher.publish('OrderCreated', { v1: { orderId: 'o-1' } });
    await vi.waitFor(() => expect(received).toHaveLength(1));
    await waitUntilPulling(names.stream, names.chargeDurable);
    const closing = orders.close();

    await orders.sender.send('ChargeCard', { orderId: 'o-2' });
    await aWhile();
    const whileClosing = await durableInfoOf(server.url, names.stream, names.chargeDurable);
    gate.open();
    await closing;

    expect(whileClosing).toMatchObject({
      num_pending: 1,
      num_ack_pending: 0,
      num_waiting: 0,
      delivered: { consumer_seq: 0 },
    });
    const next = await aMessaging(prefix);
    await next.consume(handlersOf(received));
    await vi.waitFor(() =>
      expect(received.map(({ handler }) => handler)).toContain('ChargeCard@1'),
    );
  });

  test('close waits for a running Handler and acknowledges its Message before it drains the connection', async () => {
    const prefix = aPrefix();
    const names = anOrders(prefix);
    await arrangeOrders(prefix);
    const received: Received[] = [];
    const orders = await aMessaging(prefix);
    const gate = aGate();
    await orders.consume(handlersOf(received, { notify: () => gate.opened }));
    await orders.publisher.publish('OrderCreated', { v1: { orderId: 'o-1' } });
    await vi.waitFor(() => expect(received).toHaveLength(1));
    const closing = orders.close();

    await aWhile();
    const drainedWhileRunning = orders.connections.map((connection) => connection.isDraining());
    gate.open();
    await closing;

    expect(drainedWhileRunning).toEqual([false]);
    expect(orders.connections.map((connection) => connection.isClosed())).toEqual([true]);
    const info = await durableInfoOf(server.url, names.stream, names.notifyDurable);
    expect(info).toMatchObject({ num_ack_pending: 0, ack_floor: { consumer_seq: 1 } });
  });

  test('a Message the Broker had already sent when close starts is handed back, so the next consumer gets it at once', async () => {
    const prefix = aPrefix();
    const names = anOrders(prefix);
    await arrangeOrders(prefix);
    const proxy = await aHoldingProxy(server.url);
    onTestFinished(() => proxy.stop());
    const received: Received[] = [];
    const orders = await aMessaging(prefix, { servers: proxy.url });
    await orders.consume(handlersOf(received));
    await waitUntilPulling(names.stream, names.notifyDurable);
    proxy.hold();
    await publishRaw(names.created, { orderId: 'o-1' }, [
      ['Nats-Msg-Id', 'event.OrderCreated.v1:o-1'],
      ['Cf-Loom-Fact-Id', 'o-1'],
    ]);
    await vi.waitFor(async () => {
      const info = await durableInfoOf(server.url, names.stream, names.notifyDurable);
      expect(info?.delivered.consumer_seq).toBe(1);
    });

    const closing = orders.close();
    proxy.release();
    await closing;

    expect(received).toEqual([]);
    const next = await aMessaging(prefix);
    await next.consume(handlersOf(received));
    await vi.waitFor(() => expect(received).toHaveLength(1), { timeout: 4_000 });
    expect(received[0]?.meta.deliveryCount).toBe(2);
  }, 10_000);

  test('close with pulls open leaves no timer or pull behind: the connection is closed and no durable consumer has a pull open', async () => {
    const prefix = aPrefix();
    const names = anOrders(prefix);
    await arrangeOrders(prefix);
    const timersBefore = activeTimers();
    const orders = await aMessaging(prefix);
    await orders.consume(handlersOf([]));
    await waitUntilPulling(names.stream, names.notifyDurable);
    await waitUntilPulling(names.stream, names.chargeDurable);

    await orders.close();

    expect(orders.connections.map((connection) => connection.isClosed())).toEqual([true]);
    expect(activeTimers()).toBeLessThanOrEqual(timersBefore);
    const infos = [
      await durableInfoOf(server.url, names.stream, names.notifyDurable),
      await durableInfoOf(server.url, names.stream, names.chargeDurable),
    ];
    expect(infos.map((info) => info?.num_waiting)).toEqual([0, 0]);
  });

  test('close while consume is still finding the durable consumers means no pull at all', async () => {
    const prefix = aPrefix();
    const names = anOrders(prefix);
    await arrangeOrders(prefix);
    const received: Received[] = [];
    let holding = false;
    const search = aGate();
    const holdingTheSearch: Replacing = (connection) => ({
      request: async (subject, data, options) => {
        if (holding) {
          await search.opened;
        }
        return await connection.request(subject, data, options);
      },
    });
    const orders = await aMessaging(prefix, { replacing: holdingTheSearch });
    await orders.publisher.publish('OrderCreated', { v1: { orderId: 'o-1' } });
    holding = true;
    const consuming = orders.consume(handlersOf(received));

    const closing = orders.close();
    search.open();
    await Promise.all([consuming, closing]);

    const info = await durableInfoOf(server.url, names.stream, names.notifyDurable);
    expect(received).toEqual([]);
    expect(info).toMatchObject({ num_pending: 1, num_waiting: 0, delivered: { consumer_seq: 0 } });
  });

  test('an acknowledgement the Service’s closed connection cannot send leaves the Message for redelivery, and nothing throws', async () => {
    const prefix = aPrefix();
    await arrangeOrders(prefix, { ack_wait: oneSecond });
    const received: Received[] = [];
    const orders = await aMessaging(prefix);
    const gate = aGate();
    await orders.consume(handlersOf(received, { notify: () => gate.opened }));
    await orders.publisher.publish('OrderCreated', { v1: { orderId: 'o-1' } });
    await vi.waitFor(() => expect(received).toHaveLength(1));

    await orders.connections[0]?.close();
    await sleep(800);
    gate.open();
    await orders.close();

    const next = await aMessaging(prefix);
    await next.consume(handlersOf(received));
    await vi.waitFor(() => expect(received).toHaveLength(2), { timeout: 5_000 });
    expect(received.map(({ meta }) => meta.deliveryCount)).toEqual([1, 2]);
  }, 10_000);
});

describe('pulling over jetstream()', () => {
  test('a durable consumer with a max_expires of 500 milliseconds delivers', async () => {
    const prefix = aPrefix();
    await arrangeOrders(prefix, { max_expires: oneSecond / 2 });
    const received: Received[] = [];
    const orders = await aMessaging(prefix);
    await orders.consume(handlersOf(received));

    await orders.publisher.publish('OrderCreated', { v1: { orderId: 'o-1' } });

    await vi.waitFor(() => expect(received).toHaveLength(1), { timeout: 3_000 });
  });

  test('a pull the Broker never answers is asked again', async () => {
    const prefix = aPrefix();
    await arrangeOrders(prefix, { max_expires: oneSecond });
    const received: Received[] = [];
    let lost = 0;
    const losingTheFirstTwoPulls: Replacing = (connection) => ({
      publish: (subject, data, options) => {
        if (subject.includes('.CONSUMER.MSG.NEXT.') && lost < 2) {
          lost += 1;
          return;
        }
        connection.publish(subject, data, options);
      },
    });
    const orders = await aMessaging(prefix, { replacing: losingTheFirstTwoPulls });
    await orders.publisher.publish('OrderCreated', { v1: { orderId: 'o-1' } });

    await orders.consume(handlersOf(received));

    await vi.waitFor(() => expect(received).toHaveLength(1), { timeout: 6_000 });
    expect(lost).toBe(2);
  }, 10_000);

  test('pulls that expire leave no subscription behind', async () => {
    const prefix = aPrefix();
    await arrangeOrders(prefix, { max_expires: oneSecond / 2 });
    const subscriptions: Subscription[] = [];
    let recording = false;
    const recordingSubscriptions: Replacing = (connection) => ({
      subscribe: (subject, options) => {
        const subscription = connection.subscribe(subject, options);
        if (recording) {
          subscriptions.push(subscription);
        }
        return subscription;
      },
    });
    const orders = await aMessaging(prefix, { replacing: recordingSubscriptions });
    await orders.consume(handlersOf([]));

    recording = true;
    await vi.waitFor(() => expect(subscriptions.length).toBeGreaterThanOrEqual(8), {
      timeout: 5_000,
    });

    expect(
      subscriptions.filter((subscription) => !subscription.isClosed()).length,
    ).toBeLessThanOrEqual(2);
  }, 10_000);

  test('pulls subscribe on the inbox prefix the Service’s connection was opened with', async () => {
    const prefix = aPrefix();
    await arrangeOrders(prefix);
    const subjects: string[] = [];
    let recording = false;
    const recordingSubjects: Replacing = (connection) => ({
      subscribe: (subject, options) => {
        if (recording) {
          subjects.push(subject);
        }
        return connection.subscribe(subject, options);
      },
    });
    const orders = await aMessaging(prefix, {
      replacing: recordingSubjects,
      inboxPrefix: 'svc_in',
    });
    recording = true;

    await orders.consume(handlersOf([]));

    await vi.waitFor(() => expect(subjects.length).toBeGreaterThanOrEqual(2));
    expect(subjects.filter((subject) => !subject.startsWith('svc_in.'))).toEqual([]);
  });

  test('pulls that expire leave no abort listener behind', async () => {
    const prefix = aPrefix();
    await arrangeOrders(prefix, { max_expires: oneSecond / 2 });
    const added = vi.spyOn(EventTarget.prototype, 'addEventListener');
    const removed = vi.spyOn(EventTarget.prototype, 'removeEventListener');
    const pulls: RecordedPull[] = [];
    const orders = await aMessaging(prefix, { replacing: recordingPulls(pulls) });
    await orders.consume(handlersOf([]));

    await vi.waitFor(() => expect(pulls.length).toBeGreaterThanOrEqual(8), { timeout: 5_000 });

    const listening = new Map<EventTarget, number>();
    for (const [spy, step] of [
      [added, 1],
      [removed, -1],
    ] as const) {
      spy.mock.calls.forEach(([type], call) => {
        const target = spy.mock.contexts[call] as EventTarget;
        if (type === 'abort' && target instanceof AbortSignal) {
          listening.set(target, (listening.get(target) ?? 0) + step);
        }
      });
    }
    expect(Math.max(0, ...listening.values())).toBeLessThanOrEqual(2);
  }, 10_000);

  test('a pull that expired is followed at once by the next, not after the retry pause', async () => {
    const prefix = aPrefix();
    const names = anOrders(prefix);
    await arrangeOrders(prefix, { max_expires: oneSecond / 2 });
    const pulls: RecordedPull[] = [];
    const orders = await aMessaging(prefix, { replacing: recordingPulls(pulls) });
    const received: Received[] = [];
    const ofNotify = () => pulls.filter(({ subject }) => subject.endsWith(names.notifyDurable));

    await orders.consume(handlersOf(received));

    await vi.waitFor(() => expect(ofNotify().length).toBeGreaterThanOrEqual(4), { timeout: 5_000 });
    const sentAt = ofNotify().map(({ at }) => at);
    const gaps = sentAt.slice(1).map((at, index) => at - (sentAt[index] ?? at));
    expect(Math.max(...gaps)).toBeLessThan(1_000);
    expect(received).toEqual([]);
  }, 10_000);

  test('a pull the Broker answers with 409 is asked again only after the retry pause', async () => {
    const prefix = aPrefix();
    const names = anOrders(prefix);
    await arrangeOrders(prefix);
    const pulls: RecordedPull[] = [];
    const orders = await aMessaging(prefix, { replacing: recordingPulls(pulls) });
    await orders.consume(handlersOf([]));
    await waitUntilPulling(names.stream, names.notifyDurable);
    const pulledBefore = pulls.length;

    const deletedAt = Date.now();
    await dropDurable(server.url, names.stream, names.notifyDurable);

    const nextOf = () =>
      pulls.slice(pulledBefore).find(({ subject }) => subject.endsWith(names.notifyDurable));
    await vi.waitFor(() => expect(nextOf()).toBeDefined(), { timeout: 3_000 });
    expect((nextOf()?.at ?? 0) - deletedAt).toBeGreaterThanOrEqual(900);
  }, 10_000);

  test.each([
    ['no max_expires', {}, 30],
    ['a max_expires of 5 seconds', { max_expires: 5 * oneSecond }, 5],
    ['a max_expires of 40 seconds', { max_expires: 40 * oneSecond }, 30],
    ['a max_expires of half a second', { max_expires: oneSecond / 2 }, 0.5],
  ])(
    'a pull for a durable consumer with %s expires within what it allows, 30 seconds at most',
    async (_name, settings, seconds) => {
      const prefix = aPrefix();
      await arrangeOrders(prefix, settings);
      const pulls: RecordedPull[] = [];
      const orders = await aMessaging(prefix, { replacing: recordingPulls(pulls) });

      await orders.consume(handlersOf([]));

      await vi.waitFor(() => expect(pulls.length).toBeGreaterThanOrEqual(2));
      expect(new Set(pulls.map(({ expires }) => expires))).toEqual(new Set([seconds * oneSecond]));
    },
  );

  test('close while the pulls of a durable consumer fail leaves no retry pause running', async () => {
    const timersBefore = activeTimers();
    const orders = await aConsumingWithFailingPulls(aPrefix());

    await orders.close();

    expect(activeTimers()).toBeLessThanOrEqual(timersBefore);
  }, 10_000);

  test('the Service closing its own connection while pulls fail leaves no retry pause running', async () => {
    const timersBefore = activeTimers();
    const orders = await aConsumingWithFailingPulls(aPrefix());

    await orders.connections[0]?.close();
    await sleep(100);

    expect(activeTimers()).toBeLessThanOrEqual(timersBefore);
  }, 10_000);
});
