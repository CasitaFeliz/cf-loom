// biome-ignore-all lint/style/useNamingConvention: nats.js spells its settings in snake case

import { setTimeout as sleep } from 'node:timers/promises';
import {
  defineCommand,
  defineEvent,
  defineGroup,
  defineService,
  defineSubscription,
  providedEvent,
} from '@cf-loom/contract';
import { fault, handle, type MessageFault, type MessageMeta, readersOf } from '@cf-loom/handlers';
import { type ConsumerConfig, jetstream as jetStreamClientOf } from '@nats-io/jetstream';
import { headers, type NatsConnection, type Subscription } from '@nats-io/nats-core';
import { connect } from '@nats-io/transport-node';
import { afterAll, afterEach, beforeAll, describe, expect, onTestFinished, test, vi } from 'vitest';
import { z } from 'zod';
import { planOf } from '../../test/broker-plans.ts';
import { withMethods } from '../../test/connections.ts';
import {
  arrangeDurableConsumer,
  arrangeDurableConsumersOf,
  dropDurableConsumer,
  durableConsumerInfoOf,
} from '../../test/durable-consumers.ts';
import { aHoldingProxy } from '../../test/holding-proxy.ts';
import { aNatsServer, type NatsServer } from '../../test/nats-server.ts';
import { arrangePlanOf, dropStream } from '../../test/streams.ts';
import {
  type Broker,
  type BrokerTrouble,
  CloseAbortedError,
  type ConsumedFault,
  DeadlineError,
  type Delivery,
  messaging,
} from '../index.ts';
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

const contract = defineService({
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
  commands: { chargeCardV1: { declaration: chargeCardV1, reader: orderBody } },
  subscriptions: { notifyOnCreated: { declaration: notifyOnCreated, reader: orderBody } },
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

/** Orders’ names under a prefix: its stream, its subjects and its two Durable consumers. */
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
    readonly onBrokerTrouble?: (trouble: BrokerTrouble) => void | Promise<void>;
    readonly replacing?: Replacing;
    readonly servers?: string;
    readonly inboxPrefix?: string;
  } = {},
) {
  const service = aConnect(settings.replacing, settings.servers, settings.inboxPrefix);
  const broker = jetstream({ connect: service.connect, prefix });
  const onServiceFault = settings.onServiceFault ?? (() => undefined);
  const onBrokerTrouble = settings.onBrokerTrouble ?? (() => undefined);
  const opened = await messaging(contract, broker, { onServiceFault, onBrokerTrouble });
  onTestFinished(() => opened.close().catch(unlessHandedBack));
  return { ...opened, connections: service.opened };
}

/** Lets a test that handed Messages back end, since its closing already rejected as it expected; rethrows anything else. */
function unlessHandedBack(error: unknown): void {
  if (!(error instanceof CloseAbortedError)) {
    throw error;
  }
}

/** Orders’ streams and Durable consumers on the test server, as the organization’s tooling would arrange them, with `settings` over theirs. */
async function arrangeOrders(
  prefix: string,
  settings: Partial<ConsumerConfig> = {},
): Promise<void> {
  await arrangePlanOf(server.url, contract, prefix);
  await arrangeDurableConsumersOf(server.url, planOf(contract, prefix), settings);
}

/** The plan with only the Durable consumers named kept, to arrange some of Orders’ Durable consumers and not others. */
function onlyDurableConsumersOf(plan: BrokerPlan, ...names: readonly string[]): BrokerPlan {
  const kept = Object.entries(plan.durableConsumers).filter(([name]) => names.includes(name));
  return { ...plan, durableConsumers: Object.fromEntries(kept) };
}

/** Waits for what a test expects not to happen: the window in which it would have. */
function aWhile(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 300));
}

const apply = "apply the Service's Broker plan";

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

/** Waits for the Durable consumer to hold nothing pending and nothing awaiting acknowledgement after `delivered` deliveries. */
async function waitUntilSettled(stream: string, durable: string, delivered: number): Promise<void> {
  await vi.waitFor(
    async () => {
      const info = await durableConsumerInfoOf(server.url, stream, durable);
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

/** A request for a Message a Durable consumer is pulled with: its subject, how long it waits in nanoseconds, and when it was sent. */
type RecordedPull = { readonly subject: string; readonly expires: number; readonly at: number };

/** The methods of a NATS connection that record each request for a Message a Durable consumer is pulled with. */
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

/** A consuming messaging whose Durable consumers were deleted, with its pulls failing and each loop waiting out its retry pause. */
async function aConsumingWithFailingPulls(
  prefix: string,
  onBrokerTrouble?: (trouble: BrokerTrouble) => void,
) {
  const names = anOrders(prefix);
  await arrangeOrders(prefix);
  const pulls: RecordedPull[] = [];
  const orders = await aMessaging(prefix, {
    replacing: recordingPulls(pulls),
    ...(onBrokerTrouble === undefined ? {} : { onBrokerTrouble }),
  });
  await orders.consume(handlersOf([]), {});
  await dropDurableConsumer(server.url, names.stream, names.notifyDurable);
  await dropDurableConsumer(server.url, names.stream, names.chargeDurable);
  const pulledBefore = pulls.length;
  await vi.waitFor(() => expect(pulls.length).toBeGreaterThanOrEqual(pulledBefore + 2), {
    timeout: 4_000,
  });
  await sleep(150);
  return orders;
}

/** The message of a `pull-failed` report's cause, or nothing for a recovery. */
function causeOf(trouble: BrokerTrouble): string | undefined {
  return trouble.kind === 'pull-failed' ? (trouble.cause as Error).message : undefined;
}

/** The seed of the random order of pull outcomes, printed in its test's name. */
const seed = 1 + (Date.now() % 2_147_483_646);

type Step = 'failed' | 'answered';

/** A sequence of pull outcomes drawn from the seed, the same for the same seed. */
function randomStepsOf(from: number, count: number): readonly Step[] {
  let state = from;
  const steps: Step[] = [];
  for (let index = 0; index < count; index += 1) {
    state = (state * 48_271) % 2_147_483_647;
    steps.push(state % 2 === 0 ? 'failed' : 'answered');
  }
  return steps;
}

/** The reports a sequence of pull outcomes makes: the first failure after an answer, and the first answer after a failure. */
function changesOf(steps: readonly Step[]): readonly string[] {
  const changes: string[] = [];
  let failing = false;
  for (const step of steps) {
    if (step === 'failed' && !failing) {
      changes.push('pull-failed');
    }
    if (step === 'answered' && failing) {
      changes.push('recovered');
    }
    failing = step === 'failed';
  }
  return changes;
}

/** A promise a test settles itself, to hold a Handler while it runs; opened when the test ends, so a failing test never leaves a Handler held. */
function aGate() {
  const gate = Promise.withResolvers<undefined>();
  const open = () => gate.resolve(undefined);
  onTestFinished(open);
  return { opened: gate.promise, open };
}

/** Waits until the Durable consumer has a pull open on the Broker, so a Message published now is delivered at once. */
async function waitUntilPulling(stream: string, durable: string): Promise<void> {
  await vi.waitFor(async () => {
    const info = await durableConsumerInfoOf(server.url, stream, durable);
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
  test('consume finds the prefixed Durable consumer of each Subscription and Command Version, and a Message published before or after it reaches its Handler', async () => {
    const prefix = aPrefix();
    await arrangeOrders(prefix);
    const received: Received[] = [];
    const orders = await aMessaging(prefix);
    await orders.sender.send('ChargeCard', { orderId: 'o-1' }, { factId: 'f-73' });

    await orders.consume(handlersOf(received), {});
    await orders.publisher.publish('OrderCreated', { v1: { orderId: 'o-2' } }, { factId: 'f-74' });

    await vi.waitFor(() => expect(received).toHaveLength(2));
    expect(received.map(({ handler, body }) => ({ handler, body }))).toEqual(
      expect.arrayContaining([
        { handler: 'ChargeCard@1', body: { orderId: 'o-1' } },
        { handler: 'notifyOnCreated', body: { orderId: 'o-2' } },
      ]),
    );
  });

  test('a Broker wrapping jetstream()’s Durable consumers, each { ...durableConsumer, receive }, delivers every Message to its Handler and closes, with no unhandled rejection', async () => {
    const prefix = aPrefix();
    await arrangeOrders(prefix);
    const inner = jetstream({ connect: aConnect().connect, prefix });
    const wrapped: Broker = {
      connect: async (serviceStream) => {
        const connection = await inner.connect(serviceStream);
        return {
          publish: (message) => connection.publish(message),
          consume: (durableConsumers, run) => {
            const traced = durableConsumers.map((durableConsumer) => ({
              ...durableConsumer,
              receive: (delivery: Delivery) => durableConsumer.receive(delivery),
            }));
            return connection.consume(traced, run);
          },
          close: () => connection.close(),
        };
      },
    };
    const unhandled: unknown[] = [];
    const remember = (reason: unknown) => void unhandled.push(reason);
    process.on('unhandledRejection', remember);
    onTestFinished(() => void process.off('unhandledRejection', remember));
    const received: Received[] = [];
    const orders = await messaging(contract, wrapped);
    await orders.consume(handlersOf(received), {});

    await orders.publisher.publish('OrderCreated', { v1: { orderId: 'o-1' } }, { factId: 'f-1' });
    await orders.sender.send('ChargeCard', { orderId: 'o-2' }, { factId: 'f-2' });
    await vi.waitFor(() => expect(received).toHaveLength(2));
    await orders.close();
    await aWhile();

    expect(unhandled).toEqual([]);
  });

  test('consume rejects naming each Durable consumer that does not exist and the stream it reads, and pulls from none', async () => {
    const prefix = aPrefix();
    const orders = anOrders(prefix);
    await arrangePlanOf(server.url, contract, prefix);
    const plan = planOf(contract, prefix);
    await arrangeDurableConsumersOf(server.url, onlyDurableConsumersOf(plan, orders.notifyDurable));
    const received: Received[] = [];
    const messagingOfOrders = await aMessaging(prefix);
    await messagingOfOrders.publisher.publish(
      'OrderCreated',
      { v1: { orderId: 'o-1' } },
      { factId: 'f-75' },
    );

    const consuming = messagingOfOrders.consume(handlersOf(received), {});

    await expect(consuming).rejects.toThrow(
      `The Durable consumer ${orders.chargeDurable} does not exist on the stream ${orders.stream}: ${apply}`,
    );
    await aWhile();
    const info = await durableConsumerInfoOf(server.url, orders.stream, orders.notifyDurable);
    expect(received).toEqual([]);
    expect(info).toMatchObject({ num_pending: 1, num_waiting: 0, delivered: { consumer_seq: 0 } });
  });

  test('consume rejects naming every Durable consumer that does not exist', async () => {
    const prefix = aPrefix();
    const orders = anOrders(prefix);
    await arrangePlanOf(server.url, contract, prefix);
    const messagingOfOrders = await aMessaging(prefix);

    const consuming = messagingOfOrders.consume(handlersOf([]), {});

    const error = await consuming.catch((rejected: unknown) => rejected);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message.split('\n').sort()).toEqual([
      `The Durable consumer ${orders.chargeDurable} does not exist on the stream ${orders.stream}: ${apply}`,
      `The Durable consumer ${orders.notifyDurable} does not exist on the stream ${orders.stream}: ${apply}`,
    ]);
  });

  test('consume called again once the missing Durable consumer exists starts consuming', async () => {
    const prefix = aPrefix();
    const orders = anOrders(prefix);
    await arrangePlanOf(server.url, contract, prefix);
    const plan = planOf(contract, prefix);
    await arrangeDurableConsumersOf(server.url, onlyDurableConsumersOf(plan, orders.notifyDurable));
    const received: Received[] = [];
    const messagingOfOrders = await aMessaging(prefix);
    await messagingOfOrders.publisher.publish(
      'OrderCreated',
      { v1: { orderId: 'o-1' } },
      { factId: 'f-76' },
    );
    await messagingOfOrders.sender.send('ChargeCard', { orderId: 'o-2' }, { factId: 'f-77' });
    await messagingOfOrders.consume(handlersOf(received), {}).catch(() => undefined);
    await arrangeDurableConsumersOf(server.url, onlyDurableConsumersOf(plan, orders.chargeDurable));

    await messagingOfOrders.consume(handlersOf(received), {});

    await vi.waitFor(() => expect(received).toHaveLength(2));
    expect(received.map(({ handler }) => handler).sort()).toEqual([
      'ChargeCard@1',
      'notifyOnCreated',
    ]);
  });

  test('consume rejects naming the stream when the stream a Durable consumer reads does not exist', async () => {
    const prefix = aPrefix();
    const orders = anOrders(prefix);
    await arrangeOrders(prefix);
    const messagingOfOrders = await aMessaging(prefix);
    await dropStream(server.url, orders.stream);

    const consuming = messagingOfOrders.consume(handlersOf([]), {});

    await expect(consuming).rejects.toThrow(
      `The stream ${orders.stream}, which the Durable consumer ${orders.notifyDurable} reads, does not exist: ${apply}`,
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
    [
      'one that delivers headers only',
      (orders: Orders) => ({
        ack_policy: 'explicit' as const,
        filter_subject: orders.created,
        headers_only: true,
      }),
      () => "delivers headers only, not the Message's body",
    ],
    [
      'one with priority groups pinned to a client',
      (orders: Orders) => ({
        ack_policy: 'explicit' as const,
        filter_subject: orders.created,
        priority_groups: ['g'],
        priority_policy: 'pinned_client' as const,
      }),
      () => 'has the priority groups g with the policy pinned_client, which a pull must name',
    ],
    [
      'one with priority groups under the overflow policy',
      (orders: Orders) => ({
        ack_policy: 'explicit' as const,
        filter_subject: orders.created,
        priority_groups: ['g', 'h'],
        priority_policy: 'overflow' as const,
      }),
      () => 'has the priority groups g, h with the policy overflow, which a pull must name',
    ],
  ])(
    'consume refuses %s, naming the Durable consumer and what differs',
    async (_name, config, difference) => {
      const prefix = aPrefix();
      const orders = anOrders(prefix);
      await arrangePlanOf(server.url, contract, prefix);
      const plan = planOf(contract, prefix);
      await arrangeDurableConsumersOf(
        server.url,
        onlyDurableConsumersOf(plan, orders.chargeDurable),
      );
      await arrangeDurableConsumer(server.url, orders.stream, {
        ...config(orders),
        durable_name: orders.notifyDurable,
      });
      const messagingOfOrders = await aMessaging(prefix);

      const consuming = messagingOfOrders.consume(handlersOf([]), {});

      await expect(consuming).rejects.toThrow(
        `The Durable consumer ${orders.notifyDurable} ${difference(orders)}: ${apply}`,
      );
    },
  );

  test('consume accepts a pull consumer with a deliver group, which it pulls from', async () => {
    const prefix = aPrefix();
    await arrangeOrders(prefix, { deliver_group: 'workers' });
    const received: Received[] = [];
    const orders = await aMessaging(prefix);

    await orders.consume(handlersOf(received), {});
    await orders.publisher.publish('OrderCreated', { v1: { orderId: 'o-1' } }, { factId: 'o-1' });

    await vi.waitFor(() => expect(received.map(({ body }) => body)).toEqual([{ orderId: 'o-1' }]));
  });

  test('consume accepts a Durable consumer that filters on its subject through filter_subjects', async () => {
    const prefix = aPrefix();
    const orders = anOrders(prefix);
    await arrangePlanOf(server.url, contract, prefix);
    const plan = planOf(contract, prefix);
    await arrangeDurableConsumersOf(server.url, onlyDurableConsumersOf(plan, orders.chargeDurable));
    await arrangeDurableConsumer(server.url, orders.stream, {
      ack_policy: 'explicit',
      filter_subjects: [orders.created],
      durable_name: orders.notifyDurable,
    });
    const messagingOfOrders = await aMessaging(prefix);

    const consuming = messagingOfOrders.consume(handlersOf([]), {});

    await expect(consuming).resolves.toBeUndefined();
  });

  test('a stub’s Durable consumer is not needed: consume looks only for the Durable consumers of the Handlers it pulls', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const prefix = aPrefix();
    const orders = anOrders(prefix);
    await arrangePlanOf(server.url, contract, prefix);
    const plan = planOf(contract, prefix);
    await arrangeDurableConsumersOf(server.url, onlyDurableConsumersOf(plan, orders.notifyDurable));
    const received: Received[] = [];
    const messagingOfOrders = await aMessaging(prefix);
    const handlers = {
      ...handlersOf(received),
      commands: { chargeCardV1: handle.stub(readers.commands.chargeCardV1) },
    };

    await messagingOfOrders.consume(handlers, {});
    await messagingOfOrders.publisher.publish(
      'OrderCreated',
      { v1: { orderId: 'o-1' } },
      { factId: 'f-78' },
    );

    await vi.waitFor(() =>
      expect(received.map(({ handler }) => handler)).toEqual(['notifyOnCreated']),
    );
  });

  test('without a prefix, consume looks for the unprefixed Durable consumer names', async () => {
    const unprefixed = defineService({
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
    await arrangeDurableConsumersOf(server.url, planOf(unprefixed, null));
    const received: Received[] = [];
    const opened = await messaging(unprefixed, jetstream({ connect: aConnect().connect }));
    onTestFinished(() => opened.close());

    await opened.consume(handlersOf(received), {});
    await opened.publisher.publish('OrderCreated', { v1: { orderId: 'o-1' } }, { factId: 'f-79' });

    await vi.waitFor(() => expect(received).toHaveLength(1));
    const info = await durableConsumerInfoOf(
      server.url,
      'unprefixed-service',
      'unprefixed-service_notify-on-created',
    );
    expect(info?.config.filter_subject).toBe('unprefixed-service.event.OrderCreated.v1');
  });

  test('the jetstream options reach consume: an unknown domain rejects it with the client’s error', async () => {
    const paymentSettledV1 = providedEvent('payments-service', {
      name: 'PaymentSettled',
      version: 1,
      visibility: 'internal',
      description: 'A payment was settled',
      body: z.object({ paymentId: z.string() }),
    });
    const notifyOnSettled = defineSubscription({
      name: 'notifyOnSettled',
      description: 'Notify on settled',
      event: paymentSettledV1,
    });
    const billing = defineService({
      name: 'billing-service',
      groups: [
        defineGroup({
          name: 'messages',
          description: 'Messages',
          subscriptions: [notifyOnSettled],
        }),
      ],
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
        notifyOnSettled: { declaration: notifyOnSettled, reader: paymentSettledV1.body },
      },
    });
    const handlers = {
      commands: {},
      subscriptions: {
        notifyOnSettled: handle(billingReaders.subscriptions.notifyOnSettled, () => undefined),
      },
      readers: billingReaders,
    };

    const consuming = opened.consume(handlers, {});

    await expect(consuming).rejects.toThrow('jetstream is not enabled');
  });

  test('the Handler receives the Message’s broker message id, Fact id, delivery count 1 and transport headers, without cf-loom’s own', async () => {
    const prefix = aPrefix();
    await arrangeOrders(prefix);
    const received: Received[] = [];
    const orders = await aMessaging(prefix);
    await orders.consume(handlersOf(received), {});

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
      lastAttempt: false,
      headers: { traceparent: '00-abc-def-01' },
      signal: expect.any(AbortSignal),
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
    await orders.consume(handlersOf(overJetstream), {});
    const overMemory: Received[] = [];
    const inMemory = await memory(contract);
    onTestFinished(() => inMemory.close());
    await inMemory.consume(handlersOf(overMemory), {});

    await orders.publisher.publish('OrderCreated', { v1: { orderId: 'o-1' } }, given);
    await inMemory.publisher.publish('OrderCreated', { v1: { orderId: 'o-1' } }, given);
    await inMemory.settled();

    await vi.waitFor(() => expect(overJetstream).toHaveLength(1));
    expect(overMemory).toHaveLength(1);
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
    await orders.consume(handlersOf(overJetstream), {});
    const overMemory: Received[] = [];
    const inMemory = await memory(contract);
    onTestFinished(() => inMemory.close());
    await inMemory.consume(handlersOf(overMemory), {});

    await orders.publisher.publish('OrderCreated', { v1: { orderId: 'o-1' } }, given);
    await inMemory.publisher.publish('OrderCreated', { v1: { orderId: 'o-1' } }, given);
    await inMemory.settled();

    await vi.waitFor(() => expect(overJetstream).toHaveLength(1));
    expect(overMemory).toHaveLength(1);
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
    await orders.consume(handlersOf(received), {});

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
      await orders.consume(handlersOf(received), {});

      await publishRaw(names.created, { orderId: 'o-1' }, ids);

      await vi.waitFor(async () => {
        const info = await durableConsumerInfoOf(server.url, names.stream, names.notifyDurable);
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
    await orders.consume(handlersOf(received), {});

    await orders.publisher.publish('OrderCreated', { v1: { orderId: 'o-1' } }, { factId: 'f-85' });

    await waitUntilSettled(names.stream, names.notifyDurable, 1);
    const info = await durableConsumerInfoOf(server.url, names.stream, names.notifyDurable);
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
    await orders.consume(handlersOf(received, { notify: failing }), {});

    await orders.publisher.publish('OrderCreated', { v1: { orderId: 'o-1' } }, { factId: 'f-86' });

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
    await orders.consume(handlersOf(received, { notify: throwingOnce }), {});

    await orders.publisher.publish('OrderCreated', { v1: { orderId: 'o-1' } }, { factId: 'f-87' });

    await vi.waitFor(() => expect(received).toHaveLength(2), { timeout: 5_000 });
    expect(received.map(({ meta }) => meta.deliveryCount)).toEqual([1, 2]);
    await waitUntilSettled(names.stream, names.notifyDurable, 2);
  }, 10_000);

  test('a Handler returning a retryable Fault is reported on every delivery, deliveryCounts 1, 2 and 3', async () => {
    const prefix = aPrefix();
    await arrangeOrders(prefix, { ack_wait: oneSecond, max_deliver: 3 });
    const faults: ConsumedFault[] = [];
    const orders = await aMessaging(prefix, {
      onServiceFault: (consumed) => void faults.push(consumed),
    });
    const failing = () => fault({ committed: 'no', retryable: true, message: 'card 503' });
    await orders.consume(handlersOf([], { notify: failing }), {});

    await orders.publisher.publish('OrderCreated', { v1: { orderId: 'o-1' } }, { factId: 'o-1' });

    await vi.waitFor(() => expect(faults).toHaveLength(3), { timeout: 6_000 });
    expect(faults.map(({ kind, deliveryCount }) => [kind, deliveryCount])).toEqual([
      ['returned', 1],
      ['returned', 2],
      ['returned', 3],
    ]);
  }, 10_000);

  test('only the third delivery is the last attempt of a Durable consumer with max_deliver 3', async () => {
    const prefix = aPrefix();
    await arrangeOrders(prefix, { ack_wait: oneSecond, max_deliver: 3 });
    const received: Received[] = [];
    const faults: ConsumedFault[] = [];
    const orders = await aMessaging(prefix, {
      onServiceFault: (consumed) => void faults.push(consumed),
    });
    const failing = () => fault({ committed: 'no', retryable: true, message: 'card 503' });
    await orders.consume(handlersOf(received, { notify: failing }), {});

    await orders.publisher.publish('OrderCreated', { v1: { orderId: 'o-1' } }, { factId: 'o-1' });

    await vi.waitFor(() => expect(faults).toHaveLength(3), { timeout: 6_000 });
    expect(faults.map(({ lastAttempt }) => lastAttempt)).toEqual([false, false, true]);
    expect(received.map(({ meta }) => meta.lastAttempt)).toEqual([false, false, true]);
  }, 10_000);

  test('a Durable consumer without a delivery limit never marks the last attempt', async () => {
    const prefix = aPrefix();
    await arrangeOrders(prefix, { ack_wait: oneSecond, max_deliver: -1 });
    const faults: ConsumedFault[] = [];
    const orders = await aMessaging(prefix, {
      onServiceFault: (consumed) => void faults.push(consumed),
    });
    const failing = () => fault({ committed: 'no', retryable: true, message: 'card 503' });
    await orders.consume(handlersOf([], { notify: failing }), {});

    await orders.publisher.publish('OrderCreated', { v1: { orderId: 'o-1' } }, { factId: 'o-1' });

    await vi.waitFor(() => expect(faults).toHaveLength(3), { timeout: 6_000 });
    expect(faults.map(({ lastAttempt }) => lastAttempt)).toEqual([false, false, false]);
  }, 10_000);

  test('a delivery whose onServiceFault throws is left for redelivery', async () => {
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
    await orders.consume(handlersOf(received, { notify: throwingOnce }), {});

    await orders.publisher.publish('OrderCreated', { v1: { orderId: 'o-1' } }, { factId: 'f-91' });

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
    await orders.consume(handlersOf(received, { notify: refusingOnce }), {});

    await orders.publisher.publish('OrderCreated', { v1: { orderId: 'o-1' } }, { factId: 'o-1' });

    await vi.waitFor(() => expect(received).toHaveLength(2), { timeout: 5_000 });
    expect(received.map(({ meta }) => meta.deliveryCount)).toEqual([1, 2]);
    expect(logged).toHaveBeenCalledWith(
      'notifyOnCreated orders-service.event.OrderCreated.v1 event.OrderCreated.v1:o-1 o-1 attempt 1: onServiceFault threw',
      hook,
    );
  }, 10_000);

  test('a Handler that never settles is given up at its 1 s ack wait: onServiceFault receives a thrown DeadlineError, and NATS delivers the Message again with delivery count 2', async () => {
    const prefix = aPrefix();
    await arrangeOrders(prefix, { ack_wait: oneSecond, max_deliver: 3 });
    const received: Received[] = [];
    const faults: ConsumedFault[] = [];
    const orders = await aMessaging(prefix, {
      onServiceFault: (consumed) => void faults.push(consumed),
    });
    const gate = aGate();
    await orders.consume(handlersOf(received, { notify: () => gate.opened }), {});

    await orders.publisher.publish('OrderCreated', { v1: { orderId: 'o-1' } }, { factId: 'f-93' });

    await vi.waitFor(() => expect(received).toHaveLength(2), { timeout: 4_000 });
    expect(received.map(({ meta }) => meta.deliveryCount)).toEqual([1, 2]);
    const cause = (faults[0] as { cause: unknown }).cause;
    expect(faults[0]).toMatchObject({ kind: 'thrown', deliveryCount: 1 });
    expect(cause).toBeInstanceOf(DeadlineError);
    expect(cause).toHaveProperty('message', "The Handler ran past its delivery's wait of 1000 ms");
  }, 10_000);

  test('past the wait the Durable consumer pulls its next Message while the first Handler still runs', async () => {
    const prefix = aPrefix();
    await arrangeOrders(prefix, { ack_wait: oneSecond });
    const received: Received[] = [];
    const orders = await aMessaging(prefix);
    const gate = aGate();
    const holdingTheFirstDelivery = ({ body, meta }: Received) => {
      const first = (body as { orderId: string }).orderId === 'o-1' && meta.deliveryCount === 1;
      return first ? gate.opened : undefined;
    };
    await orders.consume(handlersOf(received, { notify: holdingTheFirstDelivery }), {});

    await orders.publisher.publish('OrderCreated', { v1: { orderId: 'o-1' } }, { factId: 'f-94' });
    await orders.publisher.publish('OrderCreated', { v1: { orderId: 'o-2' } }, { factId: 'f-95' });

    const bodies = () => received.map(({ body }) => body);
    await vi.waitFor(() => expect(bodies()).toContainEqual({ orderId: 'o-2' }), { timeout: 4_000 });
    expect(received[0]?.body).toEqual({ orderId: 'o-1' });
  }, 10_000);

  test('with a backoff, a delivery’s wait is its backoff entry', async () => {
    const prefix = aPrefix();
    const waits = [oneSecond / 2, 2 * oneSecond];
    await arrangeOrders(prefix, { ack_wait: oneSecond / 2, backoff: waits, max_deliver: 3 });
    const faults: ConsumedFault[] = [];
    const orders = await aMessaging(prefix, {
      onServiceFault: (consumed) => void faults.push(consumed),
    });
    const gate = aGate();
    await orders.consume(handlersOf([], { notify: () => gate.opened }), {});

    await orders.publisher.publish('OrderCreated', { v1: { orderId: 'o-1' } }, { factId: 'f-96' });

    await vi.waitFor(() => expect(faults).toHaveLength(3), { timeout: 8_000 });
    const waited = faults.map((consumed) => (consumed as { cause: DeadlineError }).cause.waitMs);
    expect(waited).toEqual([500, 2_000, 2_000]);
  }, 15_000);

  test('each Durable consumer hands its Handler one Message at a time: a second Message waits, unpulled, until the first is settled', async () => {
    const prefix = aPrefix();
    const names = anOrders(prefix);
    await arrangeOrders(prefix);
    const received: Received[] = [];
    const orders = await aMessaging(prefix);
    const firstGate = aGate();
    const holdingTheFirst = ({ body }: Received) => {
      return (body as { orderId: string }).orderId === 'o-1' ? firstGate.opened : undefined;
    };
    await orders.consume(handlersOf(received, { notify: holdingTheFirst }), {});
    await orders.publisher.publish('OrderCreated', { v1: { orderId: 'o-1' } }, { factId: 'f-95' });
    await orders.publisher.publish('OrderCreated', { v1: { orderId: 'o-2' } }, { factId: 'f-96' });
    await vi.waitFor(() => expect(received).toHaveLength(1));

    await aWhile();
    const whileHeld = await durableConsumerInfoOf(server.url, names.stream, names.notifyDurable);
    firstGate.open();

    expect(received).toHaveLength(1);
    expect(whileHeld).toMatchObject({ num_pending: 1, delivered: { consumer_seq: 1 } });
    await waitUntilSettled(names.stream, names.notifyDurable, 2);
    expect(received.map(({ body }) => body)).toEqual([{ orderId: 'o-1' }, { orderId: 'o-2' }]);
  });

  test('the Handlers of two Durable consumers run at the same time', async () => {
    const prefix = aPrefix();
    await arrangeOrders(prefix);
    const received: Received[] = [];
    const orders = await aMessaging(prefix);
    const gate = aGate();
    await orders.consume(
      handlersOf(received, { notify: () => gate.opened, charge: () => gate.opened }),
      {},
    );

    await orders.publisher.publish('OrderCreated', { v1: { orderId: 'o-1' } }, { factId: 'f-97' });
    await orders.sender.send('ChargeCard', { orderId: 'o-2' }, { factId: 'f-98' });

    await vi.waitFor(() => expect(received).toHaveLength(2));
    gate.open();
  });

  test('a Durable consumer deleted while consuming reaches onBrokerTrouble once as pull-failed, with NATS’s answer as cause', async () => {
    const prefix = aPrefix();
    const names = anOrders(prefix);
    await arrangeOrders(prefix);
    const troubles: BrokerTrouble[] = [];
    const orders = await aMessaging(prefix, {
      onBrokerTrouble: (trouble) => void troubles.push(trouble),
    });
    await orders.consume(handlersOf([]), {});
    await waitUntilPulling(names.stream, names.notifyDurable);

    await dropDurableConsumer(server.url, names.stream, names.notifyDurable);

    await vi.waitFor(() => expect(troubles).toHaveLength(1), { timeout: 4_000 });
    await sleep(2_500);
    expect(troubles).toEqual([
      {
        declaration: notifyOnCreated,
        name: 'notifyOnCreated',
        durable: 'orders-service_notify-on-created',
        stream: 'orders-service',
        kind: 'pull-failed',
        cause: new Error(
          `NATS answered a pull from ${names.notifyDurable} with 409 Consumer Deleted`,
        ),
      },
    ]);
  }, 10_000);

  test('the same Durable consumer created again reaches onBrokerTrouble once as recovered, and its Messages reach their Handler', async () => {
    const prefix = aPrefix();
    const names = anOrders(prefix);
    await arrangeOrders(prefix);
    const troubles: BrokerTrouble[] = [];
    const received: Received[] = [];
    const orders = await aMessaging(prefix, {
      onBrokerTrouble: (trouble) => void troubles.push(trouble),
    });
    await orders.consume(handlersOf(received), {});
    await orders.publisher.publish('OrderCreated', { v1: { orderId: 'o-1' } }, { factId: 'f-99' });
    await waitUntilSettled(names.stream, names.notifyDurable, 1);
    await dropDurableConsumer(server.url, names.stream, names.notifyDurable);
    await vi.waitFor(() => expect(troubles).toHaveLength(1), { timeout: 4_000 });
    await arrangeDurableConsumer(server.url, names.stream, {
      durable_name: names.notifyDurable,
      ack_policy: 'explicit',
      filter_subject: names.created,
      deliver_policy: 'new',
    });

    await orders.publisher.publish('OrderCreated', { v1: { orderId: 'o-2' } }, { factId: 'f-100' });

    await vi.waitFor(() => expect(received).toHaveLength(2), { timeout: 6_000 });
    expect(received.map(({ body }) => body)).toEqual([{ orderId: 'o-1' }, { orderId: 'o-2' }]);
    expect(troubles.map(({ name, kind }) => [name, kind])).toEqual([
      ['notifyOnCreated', 'pull-failed'],
      ['notifyOnCreated', 'recovered'],
    ]);
  }, 10_000);

  test('a connection that closes for good while consuming reaches onBrokerTrouble once per Durable consumer as pull-failed, and nothing after', async () => {
    const own = await aNatsServer();
    onTestFinished(() => own.stop());
    const prefix = aPrefix();
    await arrangePlanOf(own.url, contract, prefix);
    await arrangeDurableConsumersOf(own.url, planOf(contract, prefix));
    const troubles: BrokerTrouble[] = [];
    const connectOnce = async () => {
      const connection = await connect({ servers: own.url, reconnect: false });
      onTestFinished(() => connection.close());
      return connection;
    };
    const orders = await messaging(contract, jetstream({ connect: connectOnce, prefix }), {
      onBrokerTrouble: (trouble) => void troubles.push(trouble),
    });
    onTestFinished(() => orders.close());
    await orders.consume(handlersOf([]), {});
    const names = anOrders(prefix);
    await vi.waitFor(async () => {
      const notify = await durableConsumerInfoOf(own.url, names.stream, names.notifyDurable);
      const charge = await durableConsumerInfoOf(own.url, names.stream, names.chargeDurable);
      expect([notify?.num_waiting, charge?.num_waiting]).toEqual([1, 1]);
    });

    await own.stop();

    await vi.waitFor(() => expect(troubles).toHaveLength(2), { timeout: 4_000 });
    await aWhile();
    const reported = troubles.map((trouble) => [trouble.name, trouble.kind, causeOf(trouble)]);
    expect(reported.sort()).toEqual([
      [
        'ChargeCard@1',
        'pull-failed',
        `NATS answered a pull from ${prefix}_orders-service_command_ChargeCard_v1 with 409 Server Shutdown`,
      ],
      [
        'notifyOnCreated',
        'pull-failed',
        `NATS answered a pull from ${prefix}_orders-service_notify-on-created with 409 Server Shutdown`,
      ],
    ]);
  }, 10_000);

  test('the Service closing its own connection while consuming reaches onBrokerTrouble once per Durable consumer as pull-failed, the connection closed', async () => {
    const prefix = aPrefix();
    const names = anOrders(prefix);
    await arrangeOrders(prefix);
    const troubles: BrokerTrouble[] = [];
    const orders = await aMessaging(prefix, {
      onBrokerTrouble: (trouble) => void troubles.push(trouble),
    });
    await orders.consume(handlersOf([]), {});
    await waitUntilPulling(names.stream, names.notifyDurable);

    await orders.connections[0]?.close();

    await vi.waitFor(() => expect(troubles).toHaveLength(2));
    await aWhile();
    const reported = troubles.map((trouble) => [trouble.name, trouble.kind, causeOf(trouble)]);
    expect(reported.sort()).toEqual([
      ['ChargeCard@1', 'pull-failed', 'The NATS connection closed'],
      ['notifyOnCreated', 'pull-failed', 'The NATS connection closed'],
    ]);
  });

  test('a connection that closes while a Durable consumer’s pulls fail reports nothing more for it, and no recovered', async () => {
    const prefix = aPrefix();
    const names = anOrders(prefix);
    await arrangeOrders(prefix, { max_expires: oneSecond / 2 });
    let lost = 0;
    const losingEveryNotifyPull: Replacing = (connection) => ({
      publish: (subject, data, options) => {
        if (subject.endsWith(`.${names.notifyDurable}`)) {
          lost += 1;
          return;
        }
        connection.publish(subject, data, options);
      },
    });
    const troubles: BrokerTrouble[] = [];
    const orders = await aMessaging(prefix, {
      replacing: losingEveryNotifyPull,
      onBrokerTrouble: (trouble) => void troubles.push(trouble),
    });
    await orders.consume(handlersOf([]), {});
    await vi.waitFor(() => expect([troubles.length, lost]).toEqual([1, 2]), { timeout: 4_000 });

    await orders.connections[0]?.close();

    await vi.waitFor(() => expect(troubles).toHaveLength(2));
    await aWhile();
    const reported = troubles.map((trouble) => [trouble.name, trouble.kind, causeOf(trouble)]);
    expect(reported.sort()).toEqual([
      ['ChargeCard@1', 'pull-failed', 'The NATS connection closed'],
      [
        'notifyOnCreated',
        'pull-failed',
        `NATS did not answer a pull from ${names.notifyDurable} within 1000 ms`,
      ],
    ]);
  }, 10_000);

  test(`pulls failing and answered in a random order are reported once per change, failing first (seed ${seed})`, async () => {
    const prefix = aPrefix();
    const names = anOrders(prefix);
    await arrangeOrders(prefix, { max_expires: oneSecond / 2 });
    const steps = randomStepsOf(seed, 10);
    let pulled = 0;
    const followingTheSteps: Replacing = (connection) => ({
      publish: (subject, data, options) => {
        if (!subject.endsWith(`.CONSUMER.MSG.NEXT.${names.stream}.${names.notifyDurable}`)) {
          connection.publish(subject, data, options);
          return;
        }
        const step = steps[pulled] ?? 'answered';
        pulled += 1;
        const missing = `${subject}-missing`;
        connection.publish(step === 'failed' ? missing : subject, data, options);
      },
    });
    const troubles: BrokerTrouble[] = [];
    const orders = await aMessaging(prefix, {
      replacing: followingTheSteps,
      onBrokerTrouble: (trouble) => void troubles.push(trouble),
    });

    await orders.consume(handlersOf([]), {});

    await vi.waitFor(() => expect(pulled).toBeGreaterThan(steps.length + 1), { timeout: 20_000 });
    expect(troubles.map(({ kind }) => kind)).toEqual(changesOf([...steps, 'answered']));
  }, 30_000);
  test('two fresh Messages on one Durable consumer reach the Handler with delivery count 1 each', async () => {
    const prefix = aPrefix();
    await arrangeOrders(prefix);
    const received: Received[] = [];
    const orders = await aMessaging(prefix);
    await orders.consume(handlersOf(received), {});

    await orders.publisher.publish('OrderCreated', { v1: { orderId: 'o-1' } }, { factId: 'f-101' });
    await orders.publisher.publish('OrderCreated', { v1: { orderId: 'o-2' } }, { factId: 'f-102' });

    await vi.waitFor(() => expect(received).toHaveLength(2));
    expect(received.map(({ meta }) => meta.deliveryCount)).toEqual([1, 1]);
  });
});

describe('closing while consuming over jetstream()', () => {
  test('close stops pulling at once: a Message published while a Handler runs is not delivered, and stays pending for the next process', async () => {
    const prefix = aPrefix();
    const names = anOrders(prefix);
    await arrangeOrders(prefix);
    const received: Received[] = [];
    const orders = await aMessaging(prefix);
    const gate = aGate();
    await orders.consume(handlersOf(received, { notify: () => gate.opened }), {});
    await orders.publisher.publish('OrderCreated', { v1: { orderId: 'o-1' } }, { factId: 'f-105' });
    await vi.waitFor(() => expect(received).toHaveLength(1));
    await waitUntilPulling(names.stream, names.chargeDurable);
    const closing = orders.close();

    await orders.sender.send('ChargeCard', { orderId: 'o-2' }, { factId: 'f-106' });
    await aWhile();
    const whileClosing = await durableConsumerInfoOf(server.url, names.stream, names.chargeDurable);
    gate.open();
    await closing;

    expect(whileClosing).toMatchObject({
      num_pending: 1,
      num_ack_pending: 0,
      num_waiting: 0,
      delivered: { consumer_seq: 0 },
    });
    const next = await aMessaging(prefix);
    await next.consume(handlersOf(received), {});
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
    await orders.consume(handlersOf(received, { notify: () => gate.opened }), {});
    await orders.publisher.publish('OrderCreated', { v1: { orderId: 'o-1' } }, { factId: 'f-107' });
    await vi.waitFor(() => expect(received).toHaveLength(1));
    const closing = orders.close();

    await aWhile();
    const drainedWhileRunning = orders.connections.map((connection) => connection.isDraining());
    gate.open();
    await closing;

    expect(drainedWhileRunning).toEqual([false]);
    expect(orders.connections.map((connection) => connection.isClosed())).toEqual([true]);
    const info = await durableConsumerInfoOf(server.url, names.stream, names.notifyDurable);
    expect(info).toMatchObject({ num_ack_pending: 0, ack_floor: { consumer_seq: 1 } });
  });

  test('a Message the Broker had already sent when close starts is handed back, so the next process gets it at once', async () => {
    const prefix = aPrefix();
    const names = anOrders(prefix);
    await arrangeOrders(prefix);
    const proxy = await aHoldingProxy(server.url);
    onTestFinished(() => proxy.stop());
    const received: Received[] = [];
    const orders = await aMessaging(prefix, { servers: proxy.url });
    await orders.consume(handlersOf(received), {});
    await waitUntilPulling(names.stream, names.notifyDurable);
    proxy.hold();
    await publishRaw(names.created, { orderId: 'o-1' }, [
      ['Nats-Msg-Id', 'event.OrderCreated.v1:o-1'],
      ['Cf-Loom-Fact-Id', 'o-1'],
    ]);
    await vi.waitFor(async () => {
      const info = await durableConsumerInfoOf(server.url, names.stream, names.notifyDurable);
      expect(info?.delivered.consumer_seq).toBe(1);
    });

    const closing = orders.close();
    proxy.release();
    await closing;

    expect(received).toEqual([]);
    const next = await aMessaging(prefix);
    await next.consume(handlersOf(received), {});
    await vi.waitFor(() => expect(received).toHaveLength(1), { timeout: 4_000 });
    expect(received[0]?.meta.deliveryCount).toBe(2);
  }, 10_000);

  test('close({ signal }) with a Handler that never settles hands its Message back, so the next process gets it at once with delivery count 2', async () => {
    const prefix = aPrefix();
    await arrangeOrders(prefix, { ack_wait: 30 * oneSecond });
    const received: Received[] = [];
    const orders = await aMessaging(prefix);
    const gate = aGate();
    await orders.consume(handlersOf(received, { notify: () => gate.opened }), {});
    await orders.publisher.publish('OrderCreated', { v1: { orderId: 'o-1' } }, { factId: 'f-112' });
    await vi.waitFor(() => expect(received).toHaveLength(1));

    const closing = orders.close({ signal: AbortSignal.abort() });

    await expect(closing).rejects.toBeInstanceOf(CloseAbortedError);
    const next = await aMessaging(prefix);
    await next.consume(handlersOf(received), {});
    await vi.waitFor(() => expect(received).toHaveLength(2), { timeout: 4_000 });
    expect(received[1]?.meta.deliveryCount).toBe(2);
  }, 10_000);

  test('close after a wait passed leaves no timer behind', async () => {
    const prefix = aPrefix();
    await arrangeOrders(prefix, { ack_wait: oneSecond, max_deliver: 1 });
    const timersBefore = activeTimers();
    const faults: ConsumedFault[] = [];
    const orders = await aMessaging(prefix, {
      onServiceFault: (consumed) => void faults.push(consumed),
    });
    const gate = aGate();
    await orders.consume(handlersOf([], { notify: () => gate.opened }), {});
    await orders.publisher.publish('OrderCreated', { v1: { orderId: 'o-1' } }, { factId: 'f-113' });
    await vi.waitFor(() => expect(faults).toHaveLength(1), { timeout: 4_000 });

    await orders.close();

    expect(activeTimers()).toBeLessThanOrEqual(timersBefore);
  }, 10_000);

  test('close with pulls open leaves no timer or pull behind: the connection is closed and no Durable consumer has a pull open', async () => {
    const prefix = aPrefix();
    const names = anOrders(prefix);
    await arrangeOrders(prefix);
    const timersBefore = activeTimers();
    const orders = await aMessaging(prefix);
    await orders.consume(handlersOf([]), {});
    await waitUntilPulling(names.stream, names.notifyDurable);
    await waitUntilPulling(names.stream, names.chargeDurable);

    await orders.close();

    expect(orders.connections.map((connection) => connection.isClosed())).toEqual([true]);
    expect(activeTimers()).toBeLessThanOrEqual(timersBefore);
    const infos = [
      await durableConsumerInfoOf(server.url, names.stream, names.notifyDurable),
      await durableConsumerInfoOf(server.url, names.stream, names.chargeDurable),
    ];
    expect(infos.map((info) => info?.num_waiting)).toEqual([0, 0]);
  });

  test('close while consume is still finding the Durable consumers means no pull at all', async () => {
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
    await orders.publisher.publish('OrderCreated', { v1: { orderId: 'o-1' } }, { factId: 'f-108' });
    holding = true;
    const consuming = orders.consume(handlersOf(received), {});

    const closing = orders.close();
    search.open();
    await Promise.all([consuming, closing]);

    const info = await durableConsumerInfoOf(server.url, names.stream, names.notifyDurable);
    expect(received).toEqual([]);
    expect(info).toMatchObject({ num_pending: 1, num_waiting: 0, delivered: { consumer_seq: 0 } });
  });

  test('an acknowledgement the Service’s closed connection cannot send leaves the Message for redelivery, and nothing throws', async () => {
    const prefix = aPrefix();
    await arrangeOrders(prefix, { ack_wait: oneSecond });
    const received: Received[] = [];
    const orders = await aMessaging(prefix);
    const gate = aGate();
    await orders.consume(handlersOf(received, { notify: () => gate.opened }), {});
    await orders.publisher.publish('OrderCreated', { v1: { orderId: 'o-1' } }, { factId: 'f-109' });
    await vi.waitFor(() => expect(received).toHaveLength(1));

    await orders.connections[0]?.close();
    await sleep(800);
    gate.open();
    await orders.close();

    const next = await aMessaging(prefix);
    await next.consume(handlersOf(received), {});
    await vi.waitFor(() => expect(received).toHaveLength(2), { timeout: 5_000 });
    expect(received.map(({ meta }) => meta.deliveryCount)).toEqual([1, 2]);
  }, 10_000);
});

describe('pulling over jetstream()', () => {
  test('a Durable consumer with a max_expires of 500 milliseconds delivers', async () => {
    const prefix = aPrefix();
    await arrangeOrders(prefix, { max_expires: oneSecond / 2 });
    const received: Received[] = [];
    const orders = await aMessaging(prefix);
    await orders.consume(handlersOf(received), {});

    await orders.publisher.publish('OrderCreated', { v1: { orderId: 'o-1' } }, { factId: 'f-110' });

    await vi.waitFor(() => expect(received).toHaveLength(1), { timeout: 3_000 });
  });

  test('a pull the Broker never answers reaches onBrokerTrouble once as pull-failed, naming the wait, and the answer to the next as recovered', async () => {
    const prefix = aPrefix();
    const names = anOrders(prefix);
    await arrangeOrders(prefix, { max_expires: oneSecond });
    const received: Received[] = [];
    const troubles: BrokerTrouble[] = [];
    let lost = 0;
    const losingTheFirstPull: Replacing = (connection) => ({
      publish: (subject, data, options) => {
        if (subject.endsWith(`.${names.notifyDurable}`) && lost < 1) {
          lost += 1;
          return;
        }
        connection.publish(subject, data, options);
      },
    });
    const orders = await aMessaging(prefix, {
      replacing: losingTheFirstPull,
      onBrokerTrouble: (trouble) => void troubles.push(trouble),
    });
    await orders.publisher.publish('OrderCreated', { v1: { orderId: 'o-1' } }, { factId: 'f-111' });

    await orders.consume(handlersOf(received), {});

    await vi.waitFor(() => expect(received).toHaveLength(1), { timeout: 6_000 });
    await vi.waitFor(() => expect(troubles).toHaveLength(2));
    expect(troubles.map((trouble) => [trouble.name, trouble.kind, causeOf(trouble)])).toEqual([
      [
        'notifyOnCreated',
        'pull-failed',
        `NATS did not answer a pull from ${names.notifyDurable} within 2000 ms`,
      ],
      ['notifyOnCreated', 'recovered', undefined],
    ]);
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
    await orders.consume(handlersOf([]), {});

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

    await orders.consume(handlersOf([]), {});

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
    await orders.consume(handlersOf([]), {});

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

    await orders.consume(handlersOf(received), {});

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
    await orders.consume(handlersOf([]), {});
    await waitUntilPulling(names.stream, names.notifyDurable);
    const pulledBefore = pulls.length;

    const deletedAt = Date.now();
    await dropDurableConsumer(server.url, names.stream, names.notifyDurable);

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
    'a pull for a Durable consumer with %s expires within what it allows, 30 seconds at most',
    async (_name, settings, seconds) => {
      const prefix = aPrefix();
      await arrangeOrders(prefix, settings);
      const pulls: RecordedPull[] = [];
      const orders = await aMessaging(prefix, { replacing: recordingPulls(pulls) });

      await orders.consume(handlersOf([]), {});

      await vi.waitFor(() => expect(pulls.length).toBeGreaterThanOrEqual(2));
      expect(new Set(pulls.map(({ expires }) => expires))).toEqual(new Set([seconds * oneSecond]));
    },
  );

  test('close while the pulls of a Durable consumer fail leaves no retry pause running', async () => {
    const timersBefore = activeTimers();
    const orders = await aConsumingWithFailingPulls(aPrefix());

    await orders.close();

    expect(activeTimers()).toBeLessThanOrEqual(timersBefore);
  }, 10_000);

  test('close while pulls fail reports nothing more', async () => {
    const troubles: BrokerTrouble[] = [];
    const orders = await aConsumingWithFailingPulls(aPrefix(), (trouble) => {
      troubles.push(trouble);
    });
    const reportedBefore = troubles.map(({ name, kind }) => [name, kind]);

    await orders.close();
    await aWhile();

    expect(troubles.map(({ name, kind }) => [name, kind])).toEqual(reportedBefore);
    expect(reportedBefore).toHaveLength(2);
  }, 10_000);

  test('the Service closing its own connection while pulls fail leaves no retry pause running', async () => {
    const timersBefore = activeTimers();
    const orders = await aConsumingWithFailingPulls(aPrefix());

    await orders.connections[0]?.close();
    await sleep(100);

    expect(activeTimers()).toBeLessThanOrEqual(timersBefore);
  }, 10_000);
});
