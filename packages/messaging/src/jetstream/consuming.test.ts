// biome-ignore-all lint/style/useNamingConvention: nats.js spells its settings in snake case
import {
  type ContractPackage,
  defineCommand,
  defineContract,
  defineDependencies,
  defineEvent,
  defineSubscription,
} from '@cf-loom/contract';
import { type Fault, fault, handle, type MessageMeta, withReader } from '@cf-loom/handlers';
import { type ConsumerConfig, jetstream as jetStreamClientOf } from '@nats-io/jetstream';
import { headers, type NatsConnection } from '@nats-io/nats-core';
import { connect } from '@nats-io/transport-node';
import { setTimeout as sleep } from 'node:timers/promises';
import { afterAll, afterEach, beforeAll, describe, expect, onTestFinished, test, vi } from 'vitest';
import { z } from 'zod';
import { arrangeDurable, arrangeDurablesOf, durableInfoOf } from '../../test/durables.ts';
import { aNatsServer, type NatsServer } from '../../test/nats-server.ts';
import { arrangePlanOf, dropStream, planOf } from '../../test/streams.ts';
import { type ConsumedFault, type Messaging, messaging } from '../index.ts';
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
async function aMessaging(
  prefix: string,
  onServiceFault: (fault: ConsumedFault) => void = () => undefined,
): Promise<Messaging<typeof contract>> {
  const broker = jetstream({ connect: aConnect().connect, prefix });
  const opened = await messaging(contract, broker, { onServiceFault });
  onTestFinished(() => opened.close());
  return opened;
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
      messageId: 'OrderCreated.v1:o-1:created',
      factId: 'o-1:created',
      deliveryCount: 1,
      headers: { traceparent: '00-abc-def-01' },
    });
  });

  test('a header published with several values reaches the Handler as its values joined with ", "', async () => {
    const prefix = aPrefix();
    const names = anOrders(prefix);
    await arrangeOrders(prefix);
    const received: Received[] = [];
    const orders = await aMessaging(prefix);
    await orders.consume(handlersOf(received));

    await publishRaw(names.created, { orderId: 'o-1' }, [
      ['Nats-Msg-Id', 'OrderCreated.v1:o-1'],
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
    const orders = await aMessaging(prefix, () => {
      throw new Error('the hook is down');
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
});
