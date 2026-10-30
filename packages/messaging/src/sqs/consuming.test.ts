// biome-ignore-all lint/style/useNamingConvention: AWS names its fields in PascalCase, as they travel

import { createHash } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import type { SQSClient } from '@aws-sdk/client-sqs';
import { fault, handle } from '@cf-loom/handlers';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  onTestFinished,
  test,
  vi,
} from 'vitest';
import {
  arrangeTopic,
  dropQueue,
  setQueueAttributes,
  setSubscriptionAttribute,
  storeIn,
  subscribeByHand,
  tagByHand,
  unsubscribe,
  untagByHand,
  wakeEach,
} from '../../test/aws-arranging.ts';
import {
  aClosedUrl,
  alteringAnswers,
  anAwsConnecting,
  countCommands,
  failingCommand,
} from '../../test/aws-clients.ts';
import {
  messagesWithAttributesIn,
  queueCountsOf,
  queueNamesOf,
  queueTagsOf,
  receivedFrom,
} from '../../test/aws-reading.ts';
import { aMotoServer, type MotoServer } from '../../test/moto-server.ts';
import {
  anOrders,
  arrangeOrders,
  handlersOf,
  longCommandName,
  longHandlersOf,
  ordersContract,
  ordersReaders,
  ordersWithLongCommand,
  type Received,
  testLimits,
} from '../../test/orders.ts';
import { until } from '../../test/until.ts';
import { type BrokerTrouble, type ConsumedFault, type DeadlineError, messaging } from '../index.ts';
import {
  type Duration,
  type SqsBrokerLimits,
  type SqsConnecting,
  type SqsDurableConsumerLimits,
  sqs,
} from './index.ts';

let moto: MotoServer;

beforeAll(async () => {
  moto = await aMotoServer();
});

afterAll(async () => {
  await moto.stop();
});

beforeEach(async () => {
  await moto.reset();
});

/** Closes a messaging when the test ends, waking its open polls so the closing does not wait them out. */
function closedWhenDone(
  started: { readonly close: () => Promise<void> },
  connecting: SqsConnecting,
  orders: ReturnType<typeof anOrders> = anOrders('staging'),
): void {
  onTestFinished(async () => {
    const closing = started.close();
    for (const queue of [orders.notifyQueue, orders.chargeQueue]) {
      await wakeEach(connecting.sqs, [queue]).catch(() => undefined);
    }
    await closing.catch(() => undefined);
  });
}

/** What a test of Orders over sqs() may set: its Broker prefix, the limits its queues are made with and the hooks of its messaging. */
type Settings = {
  readonly prefix?: string | null;
  readonly limits?: SqsBrokerLimits;
  readonly onServiceFault?: (fault: ConsumedFault) => void | Promise<void>;
  readonly onBrokerTrouble?: (trouble: BrokerTrouble) => void | Promise<void>;
};

/** An Orders messaging over sqs() on the test's moto, closed when the test ends, with the names it works with. */
async function aMessaging(settings: Settings = {}) {
  const { prefix = 'staging', limits, onServiceFault, onBrokerTrouble } = settings;
  const connecting = anAwsConnecting(moto.url);
  await arrangeOrders(connecting, { prefix, ...(limits === undefined ? {} : { limits }) });
  const hooks = {
    onServiceFault: onServiceFault ?? (() => undefined),
    onBrokerTrouble: onBrokerTrouble ?? (() => undefined),
  };
  const broker = sqs(prefix === null ? connecting : { ...connecting, prefix });
  const started = await messaging(ordersContract, broker, hooks);
  const orders = anOrders(prefix);
  closedWhenDone(started, connecting, orders);
  return { ...started, connecting, orders };
}

/** The limits of the test's queues with these settings of a Durable consumer over the default ones. */
function limitsWith(settings: Partial<SqsDurableConsumerLimits>): SqsBrokerLimits {
  return { durableConsumerDefaults: { ...testLimits.durableConsumerDefaults, ...settings } };
}

/** What `aMessaging` gives a test. */
type AMessaging = Awaited<ReturnType<typeof aMessaging>>;

describe('consuming over sqs()', () => {
  test('consume finds the prefixed queue of each Subscription and Command Version, and a Message published before or after reaches its Handler', async () => {
    const { publisher, sender, consume } = await aMessaging();
    const received: Received[] = [];
    await publisher.publish('OrderCreated', { v1: { orderId: 'o-1' } }, { factId: 'f-1' });
    await sender.send('ChargeCard', { orderId: 'o-2' }, { factId: 'f-2' });

    await consume(handlersOf(received), {});
    await publisher.publish('OrderCreated', { v1: { orderId: 'o-3' } }, { factId: 'f-3' });
    await sender.send('ChargeCard', { orderId: 'o-4' }, { factId: 'f-4' });

    await until(() => expect(received).toHaveLength(4));
    const handled = received.map(({ handler, body }) => `${handler} ${JSON.stringify(body)}`);
    expect(handled.sort()).toEqual([
      'ChargeCard@1 {"orderId":"o-2"}',
      'ChargeCard@1 {"orderId":"o-4"}',
      'notifyOnCreated {"orderId":"o-1"}',
      'notifyOnCreated {"orderId":"o-3"}',
    ]);
  });

  test('consume rejects naming each Durable consumer whose queue does not exist', async () => {
    const connecting = anAwsConnecting(moto.url);
    await arrangeTopic(connecting.sns, 'staging_orders-service');
    const { consume } = await messaging(ordersContract, sqs({ ...connecting, prefix: 'staging' }));
    const orders = anOrders('staging');

    const consuming = consume(handlersOf([]), {});

    await expect(consuming).rejects.toMatchObject({
      message: expect.stringContaining(
        `The Durable consumer ${orders.notifyDurable} has no queue ${orders.notifyQueue}: apply the Service's Broker plan`,
      ),
    });
    await expect(consuming).rejects.toMatchObject({
      message: expect.stringContaining(
        `The Durable consumer ${orders.chargeDurable} has no queue ${orders.chargeQueue}: apply the Service's Broker plan`,
      ),
    });
  });

  test('consume with one queue missing receives from none: the Message in the other stays in its queue', async () => {
    const { sender, consume, connecting, orders } = await aMessaging();
    await dropQueue(connecting.sqs, orders.notifyQueue);
    await sender.send('ChargeCard', { orderId: 'o-1' }, { factId: 'f-1' });
    const received: Received[] = [];

    const consuming = consume(handlersOf(received), {});

    await expect(consuming).rejects.toThrow(
      `The Durable consumer ${orders.notifyDurable} has no queue`,
    );
    await expect(queueCountsOf(connecting.sqs, orders.chargeQueue)).resolves.toEqual({
      visible: 1,
      inFlight: 0,
    });
    expect(received).toEqual([]);
  });

  test('any other error of the queue check rejects consume unchanged, and nothing is received', async () => {
    const working = anAwsConnecting(moto.url);
    await arrangeOrders(working, { prefix: 'staging' });
    const broken = anAwsConnecting(moto.url, { sqsUrl: await aClosedUrl() });
    const { sender, consume } = await messaging(
      ordersContract,
      sqs({ ...broken, prefix: 'staging' }),
    );
    await sender.send('ChargeCard', { orderId: 'o-1' }, { factId: 'f-1' });
    const received: Received[] = [];

    const consuming = consume(handlersOf(received), {});

    await expect(consuming).rejects.toMatchObject({ code: 'ECONNREFUSED' });
    await expect(queueCountsOf(working.sqs, anOrders('staging').chargeQueue)).resolves.toEqual({
      visible: 1,
      inFlight: 0,
    });
    expect(received).toEqual([]);
  });

  test('any other error of the subscription check rejects consume unchanged, and nothing is received', async () => {
    const { sender, consume, connecting, orders } = await aMessaging();
    const refusal = new Error('SNS is down');
    failingCommand(connecting.sns, { command: 'GetSubscriptionAttributesCommand', error: refusal });
    await sender.send('ChargeCard', { orderId: 'o-1' }, { factId: 'f-1' });
    const received: Received[] = [];

    const consuming = consume(handlersOf(received), {});

    await expect(consuming).rejects.toBe(refusal);
    await expect(queueCountsOf(connecting.sqs, orders.chargeQueue)).resolves.toEqual({
      visible: 1,
      inFlight: 0,
    });
    expect(received).toEqual([]);
  });

  test('a stub’s Durable consumer needs no queue: consume looks only for the queues of the Handlers it pulls', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { sender, publisher, consume, connecting, orders } = await aMessaging();
    await dropQueue(connecting.sqs, orders.chargeQueue);
    const received: Received[] = [];
    const handlers = {
      ...handlersOf(received),
      commands: { chargeCardV1: handle.stub(ordersReaders.commands.chargeCardV1) },
    };

    await consume(handlers, {});
    await publisher.publish('OrderCreated', { v1: { orderId: 'o-1' } }, { factId: 'f-1' });

    await until(() => expect(received.map(({ handler }) => handler)).toEqual(['notifyOnCreated']));
    expect(sender).toBeDefined();
  });

  test('without a prefix, consume looks for the unprefixed queue names', async () => {
    const { sender, consume } = await aMessaging({ prefix: null });
    const received: Received[] = [];
    await sender.send('ChargeCard', { orderId: 'o-1' }, { factId: 'f-1' });

    await consume(handlersOf(received), {});

    await until(() => expect(received.map(({ handler }) => handler)).toEqual(['ChargeCard@1']));
  });

  test('a Durable consumer whose name is longer than 76 characters finds its hashed queue', async () => {
    const connecting = anAwsConnecting(moto.url);
    const contract = ordersWithLongCommand;
    await arrangeOrders(connecting, { prefix: 'staging', contract });
    const started = await messaging(contract, sqs({ ...connecting, prefix: 'staging' }));
    const durable = `staging_orders-service_command_${longCommandName}_v1`;
    const digest = createHash('sha256').update(durable).digest('hex').slice(0, 12);
    const hashed = `${durable.slice(0, 63)}-${digest}`;
    closedWhenDone(started, connecting, { notifyQueue: hashed, chargeQueue: hashed } as never);
    await started.sender.send(longCommandName, { orderId: 'o-1' }, { factId: 'f-1' });
    const received: Received[] = [];

    await started.consume(longHandlersOf(received), {});

    await until(() => expect(received.map(({ body }) => body)).toEqual([{ orderId: 'o-1' }]));
    await expect(queueNamesOf(connecting.sqs)).resolves.toContain(hashed);
  });

  test('the Handler receives the Message’s Broker message id, Fact id, delivery count 1 and Transport headers', async () => {
    const { publisher, consume } = await aMessaging();
    const received: Received[] = [];
    await consume(handlersOf(received), {});

    await publisher.publish(
      'OrderCreated',
      { v1: { orderId: 'o-1' } },
      { factId: 'o-1:created', headers: { traceparent: '00-abc-def-01' } },
    );

    await until(() => expect(received).toHaveLength(1));
    expect(received[0]?.meta).toEqual({
      messageId: 'event.OrderCreated.v1:o-1:created',
      factId: 'o-1:created',
      deliveryCount: 1,
      lastAttempt: false,
      headers: { traceparent: '00-abc-def-01' },
      signal: expect.any(AbortSignal),
    });
  });

  test('returning nothing deletes the Message: the queue holds nothing, visible or in flight', async () => {
    const { publisher, consume, connecting, orders } = await aMessaging();
    const received: Received[] = [];
    await consume(handlersOf(received), {});

    await publisher.publish('OrderCreated', { v1: { orderId: 'o-1' } }, { factId: 'f-1' });

    await until(() => expect(received).toHaveLength(1));
    await until(async () => {
      const counts = await queueCountsOf(connecting.sqs, orders.notifyQueue);
      expect(counts).toEqual({ visible: 0, inFlight: 0 });
    });
  });

  test('a Fault that is not retryable deletes the Message: it is not delivered again', async () => {
    const { publisher, consume, connecting, orders } = await aMessaging({
      limits: limitsWith({ ackWait: '1s' }),
    });
    const received: Received[] = [];
    const failing = () => fault({ committed: 'no', retryable: false, message: 'cannot be done' });
    await consume(handlersOf(received, { notify: failing }), {});

    await publisher.publish('OrderCreated', { v1: { orderId: 'o-1' } }, { factId: 'f-1' });

    await until(async () => {
      const counts = await queueCountsOf(connecting.sqs, orders.notifyQueue);
      expect(counts).toEqual({ visible: 0, inFlight: 0 });
    });
    expect(received).toHaveLength(1);
  });

  test('a throw leaves the Message, and SQS delivers it again after the visibility timeout with delivery count 2', async () => {
    const { publisher, consume } = await aMessaging({ limits: limitsWith({ ackWait: '1s' }) });
    const received: Received[] = [];
    const throwingOnce = ({ meta }: Received) => {
      if (meta.deliveryCount === 1) {
        throw new Error('the database is down');
      }
      return undefined;
    };
    await consume(handlersOf(received, { notify: throwingOnce }), {});

    await publisher.publish('OrderCreated', { v1: { orderId: 'o-1' } }, { factId: 'f-1' });

    await until(() => expect(received).toHaveLength(2));
    expect(received.map(({ meta }) => meta.deliveryCount)).toEqual([1, 2]);
  });

  test('only the receive the redrive’s maxReceiveCount reaches is the last attempt, and the Message then moves to the dead-letter queue', async () => {
    const { publisher, consume, connecting, orders } = await aMessaging({
      limits: limitsWith({ ackWait: '1s', maxDeliver: 3 }),
    });
    const received: Received[] = [];
    const failing = () => fault({ committed: 'no', retryable: true, message: 'card 503' });
    await consume(handlersOf(received, { notify: failing }), {});

    await publisher.publish('OrderCreated', { v1: { orderId: 'o-1' } }, { factId: 'f-1' });

    await until(async () => {
      const dead = await receivedFrom(connecting.sqs, `${orders.notifyQueue}_dlq`);
      expect(dead).toHaveLength(1);
    });
    expect(received.map(({ meta }) => [meta.deliveryCount, meta.lastAttempt])).toEqual([
      [1, false],
      [2, false],
      [3, true],
    ]);
  });

  test('delivery 1 waits the queue’s visibility timeout, and with a backoff tag each later delivery waits its entry, the last repeating, the queue showing the Message in flight while each Handler waits', async () => {
    const faults: ConsumedFault[] = [];
    const { publisher, consume, connecting, orders } = await aMessaging({
      limits: limitsWith({ ackWait: ['1s', '2s'], maxDeliver: 3 }),
      onServiceFault: (consumed) => void faults.push(consumed),
    });
    const samples: { visible: number; inFlight: number }[] = [];
    const watching = async ({ meta }: Received) => {
      while (!meta.signal.aborted) {
        samples.push(await queueCountsOf(connecting.sqs, orders.notifyQueue));
        await sleep(100);
      }
      return undefined;
    };
    await consume(handlersOf([], { notify: watching }), {});

    await publisher.publish('OrderCreated', { v1: { orderId: 'o-1' } }, { factId: 'f-1' });

    await until(() => expect(faults).toHaveLength(3));
    const waited = faults.map((consumed) => (consumed as { cause: DeadlineError }).cause.waitMs);
    expect(waited).toEqual([1_000, 2_000, 2_000]);
    expect(samples.length).toBeGreaterThan(0);
    expect(new Set(samples.map(({ visible }) => visible))).toEqual(new Set([0]));
  });

  test('a visibility change that fails before a later delivery leaves its Handler unrun, reaches onBrokerTrouble once as pull-failed with the client’s error, and the Message comes back after the visibility timeout; the next answered pull reaches it as recovered', async () => {
    const troubles: BrokerTrouble[] = [];
    const { publisher, consume, connecting } = await aMessaging({
      limits: limitsWith({ ackWait: ['1s', '2s'], maxDeliver: 5 }),
      onBrokerTrouble: (trouble) => void troubles.push(trouble),
    });
    const refusal = new Error('SQS refused the visibility change');
    failingCommand(connecting.sqs, {
      command: 'ChangeMessageVisibilityCommand',
      error: refusal,
      times: 1,
    });
    const received: Received[] = [];
    const throwingOnce = ({ meta }: Received) => {
      if (meta.deliveryCount === 1) {
        throw new Error('the database is down');
      }
      return undefined;
    };
    await consume(handlersOf(received, { notify: throwingOnce }), {});

    await publisher.publish('OrderCreated', { v1: { orderId: 'o-1' } }, { factId: 'f-1' });

    await until(() =>
      expect(troubles.map(({ kind }) => kind)).toEqual(['pull-failed', 'recovered']),
    );
    await until(() => expect(received).toHaveLength(2));
    expect(troubles[0]).toMatchObject({ kind: 'pull-failed', cause: refusal });
    expect(received.map(({ meta }) => meta.deliveryCount)).toEqual([1, 3]);
  });

  test('a Message without cf-loom’s attributes is left: one console line per Delivery names the queue and what it lacks, nothing reaches onServiceFault, and after maxReceiveCount receives it is in the dead-letter queue with its body and attributes', async () => {
    const written = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const faults: ConsumedFault[] = [];
    const { consume, connecting, orders } = await aMessaging({
      limits: limitsWith({ ackWait: '1s', maxDeliver: 3 }),
      onServiceFault: (consumed) => void faults.push(consumed),
    });
    const id = await storeIn(connecting.sqs, orders.notifyQueue, {
      body: 'not cf-loom’s',
      attributes: { 'x-other': { DataType: 'String', StringValue: 'kept' } },
    });
    const received: Received[] = [];

    await consume(handlersOf(received), {});

    const dead = `${orders.notifyQueue}_dlq`;
    await until(async () => {
      expect(await messagesWithAttributesIn(connecting.sqs, dead)).toEqual([
        { body: 'not cf-loom’s', attributes: { 'x-other': 'kept' } },
      ]);
    });
    const lines = written.mock.calls.map(([line]) => String(line)).filter(isLeftLine);
    const line = `${orders.notifyQueue}: left SQS message ${id} for the dead-letter queue, since it lacks or cannot read cf-loom-message-id, cf-loom-fact-id, cf-loom-headers`;
    expect(lines).toEqual([line, line, line]);
    expect(received).toEqual([]);
    expect(faults).toEqual([]);
  });

  test('a Message delivered in SNS’s envelope, raw delivery turned off after consume started, is left the same way and reaches the dead-letter queue intact', async () => {
    const written = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { publisher, consume, connecting, orders } = await aMessaging({
      limits: limitsWith({ ackWait: '1s', maxDeliver: 3 }),
    });
    const received: Received[] = [];
    await consume(handlersOf(received), {});
    const arn =
      (await queueTagsOf(connecting.sqs, orders.notifyQueue))['cf-loom:subscription'] ?? '';
    await setSubscriptionAttribute(connecting.sns, arn, {
      name: 'RawMessageDelivery',
      value: 'false',
    });

    await publisher.publish('OrderCreated', { v1: { orderId: 'o-1' } }, { factId: 'f-1' });

    const dead = `${orders.notifyQueue}_dlq`;
    await until(async () => {
      const stored = await messagesWithAttributesIn(connecting.sqs, dead);
      expect(stored).toHaveLength(1);
      expect(JSON.parse(stored[0]?.body ?? '')).toMatchObject({
        Type: 'Notification',
        Message: '{"orderId":"o-1"}',
      });
    });
    const lines = written.mock.calls.map(([line]) => String(line)).filter(isLeftLine);
    expect(lines).toHaveLength(3);
    expect(
      lines.every((line) => line.endsWith('cf-loom-message-id, cf-loom-fact-id, cf-loom-headers')),
    ).toBe(true);
    expect(received).toEqual([]);
  });

  test('an unreadable Message on a queue with a backoff tag gets no visibility change: it is in flight until its next receive, which the visibility timeout brings', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { consume, connecting, orders } = await aMessaging({
      limits: limitsWith({ ackWait: ['1s', '1s'], maxDeliver: 3 }),
    });
    const changes = countCommands(connecting.sqs, 'ChangeMessageVisibilityCommand');
    await storeIn(connecting.sqs, orders.notifyQueue, 'not cf-loom’s');

    await consume(handlersOf([]), {});

    await until(async () => {
      const counts = await queueCountsOf(connecting.sqs, orders.notifyQueue);
      expect(counts).toEqual({ visible: 0, inFlight: 1 });
    });
    await until(async () => {
      expect(
        await messagesWithAttributesIn(connecting.sqs, `${orders.notifyQueue}_dlq`),
      ).toHaveLength(1);
    });
    expect(changes.sent()).toBe(0);
  });

  describe('a Message with cf-loom’s attributes in a form cf-loom cannot read', () => {
    const valid = {
      'cf-loom-message-id': '"event.OrderCreated.v1:f-1"',
      'cf-loom-fact-id': '"f-1"',
      'cf-loom-headers': '{}',
    };
    const asString = (value: string) => ({ DataType: 'String', StringValue: value });

    /** The attributes of a Message that cf-loom reads, but for one that `replacing` gives in another form. */
    const withOne = (name: keyof typeof valid, replacing: RawAttribute) => ({
      'cf-loom-message-id': asString(valid['cf-loom-message-id']),
      'cf-loom-fact-id': asString(valid['cf-loom-fact-id']),
      'cf-loom-headers': asString(valid['cf-loom-headers']),
      [name]: replacing,
    });

    const attributeCases = [
      {
        reason: 'DataType Number',
        name: 'cf-loom-message-id',
        attribute: { DataType: 'Number', StringValue: '1' },
      },
      {
        reason: 'DataType String.json',
        name: 'cf-loom-fact-id',
        attribute: { DataType: 'String.json', StringValue: '"f-1"' },
      },
      {
        reason: 'DataType Binary',
        name: 'cf-loom-headers',
        attribute: { DataType: 'Binary', BinaryValue: new TextEncoder().encode('{}') },
      },
      {
        reason: 'a String with an empty StringValue',
        name: 'cf-loom-fact-id',
        attribute: { DataType: 'String', StringValue: '' },
      },
    ] as const;

    test('the table holds each attribute cf-loom reads and each form it cannot read', () => {
      const names = new Set<string>(attributeCases.map(({ name }) => name));
      const reasons = attributeCases.map(({ reason }) => reason);

      expect(names).toEqual(new Set(Object.keys(valid)));
      expect(reasons).toEqual([
        'DataType Number',
        'DataType String.json',
        'DataType Binary',
        'a String with an empty StringValue',
      ]);
    });

    test.each(attributeCases)(
      'a Message whose $name is $reason is left for the dead-letter queue, its console line naming that attribute',
      async ({ name, attribute }) => {
        const written = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const { consume, connecting, orders } = await aMessaging({
          limits: limitsWith({ ackWait: '1s', maxDeliver: 3 }),
        });
        const id = await storeIn(connecting.sqs, orders.notifyQueue, {
          body: '{"orderId":"o-1"}',
          attributes: withOne(name, attribute),
        });
        const received: Received[] = [];

        await consume(handlersOf(received), {});

        const line = `${orders.notifyQueue}: left SQS message ${id} for the dead-letter queue, since it lacks or cannot read ${name}`;
        await until(() => expect(written.mock.calls.map(([text]) => String(text))).toContain(line));
        expect(received).toEqual([]);
      },
    );
  });

  describe('a Message whose receive count cf-loom cannot read', () => {
    /** Makes the queue's answers to `ReceiveMessage` carry this `ApproximateReceiveCount`, or none. */
    function answeringReceiveCount(sqsClient: SQSClient, count: string | undefined): void {
      alteringAnswers(sqsClient, 'ReceiveMessageCommand', (output) => {
        const messages = (output['Messages'] ?? []) as { Attributes?: Record<string, string> }[];
        for (const message of messages) {
          message.Attributes = count === undefined ? {} : { ApproximateReceiveCount: count };
        }
      });
    }

    test.each([
      ['absent', undefined],
      ['0', '0'],
      ['-1', '-1'],
      ['not a number', 'many'],
      ['not a whole number', '1.5'],
      ['written with a leading zero', '01'],
      ['written in exponent form', '1e3'],
    ])(
      'a Message whose ApproximateReceiveCount is %s is left for the dead-letter queue, its console line naming it',
      async (_, count) => {
        const written = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const { publisher, consume, connecting, orders } = await aMessaging();
        answeringReceiveCount(connecting.sqs, count);
        const received: Received[] = [];
        await consume(handlersOf(received), {});

        await publisher.publish('OrderCreated', { v1: { orderId: 'o-1' } }, { factId: 'f-1' });

        const left = `${orders.notifyQueue}: left SQS message `;
        const reason =
          ' for the dead-letter queue, since it lacks or cannot read ApproximateReceiveCount';
        await until(() => {
          const lines = written.mock.calls.map(([text]) => String(text));
          expect(lines.some((line) => line.startsWith(left) && line.endsWith(reason))).toBe(true);
        });
        expect(received).toEqual([]);
      },
    );
  });

  test('each Durable consumer hands its Handler one Message at a time: a second Message stays in the queue, not received, until the first is settled', async () => {
    const { publisher, consume, connecting, orders } = await aMessaging();
    const received: Received[] = [];
    const gate = aGate();
    const holdingTheFirst = ({ body }: Received) =>
      (body as { orderId: string }).orderId === 'o-1' ? gate.opened : undefined;
    await consume(handlersOf(received, { notify: holdingTheFirst }), {});

    await publisher.publish('OrderCreated', { v1: { orderId: 'o-1' } }, { factId: 'f-1' });
    await until(() => expect(received).toHaveLength(1));
    await publisher.publish('OrderCreated', { v1: { orderId: 'o-2' } }, { factId: 'f-2' });

    await expect(queueCountsOf(connecting.sqs, orders.notifyQueue)).resolves.toEqual({
      visible: 1,
      inFlight: 1,
    });
    expect(received).toHaveLength(1);
    gate.open();
    await until(() => expect(received).toHaveLength(2));
    expect(received.map(({ body }) => body)).toEqual([{ orderId: 'o-1' }, { orderId: 'o-2' }]);
  });

  test('the Handlers of two Durable consumers run at the same time', async () => {
    const { publisher, sender, consume } = await aMessaging();
    const received: Received[] = [];
    const gate = aGate();
    await consume(
      handlersOf(received, { notify: () => gate.opened, charge: () => gate.opened }),
      {},
    );

    await publisher.publish('OrderCreated', { v1: { orderId: 'o-1' } }, { factId: 'f-1' });
    await sender.send('ChargeCard', { orderId: 'o-2' }, { factId: 'f-2' });

    await until(() =>
      expect(received.map(({ handler }) => handler).sort()).toEqual([
        'ChargeCard@1',
        'notifyOnCreated',
      ]),
    );
  });

  test('a delivery whose onServiceFault throws is left for redelivery', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { publisher, consume } = await aMessaging({
      limits: limitsWith({ ackWait: '1s' }),
      onServiceFault: () => {
        throw new Error('the hook is down');
      },
    });
    const received: Received[] = [];
    const failing = () => fault({ committed: 'no', retryable: false, message: 'cannot be done' });
    await consume(handlersOf(received, { notify: failing }), {});

    await publisher.publish('OrderCreated', { v1: { orderId: 'o-1' } }, { factId: 'f-1' });

    await until(() => expect(received.length).toBeGreaterThanOrEqual(2));
    expect(received.slice(0, 2).map(({ meta }) => meta.deliveryCount)).toEqual([1, 2]);
  });

  test('two fresh Messages on one queue reach the Handler with delivery count 1 each', async () => {
    const { publisher, consume } = await aMessaging();
    const received: Received[] = [];
    await consume(handlersOf(received), {});

    await publisher.publish('OrderCreated', { v1: { orderId: 'o-1' } }, { factId: 'f-1' });
    await publisher.publish('OrderCreated', { v1: { orderId: 'o-2' } }, { factId: 'f-2' });

    await until(() => expect(received).toHaveLength(2));
    expect(received.map(({ meta }) => meta.deliveryCount)).toEqual([1, 1]);
  });

  test('a DeleteMessage SQS refuses while consuming reaches neither hook nor the console, and the Message comes back after its wait', async () => {
    const written = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const hooked: unknown[] = [];
    const { publisher, consume, connecting } = await aMessaging({
      limits: limitsWith({ ackWait: '1s' }),
      onServiceFault: (consumed) => void hooked.push(consumed),
      onBrokerTrouble: (trouble) => void hooked.push(trouble),
    });
    const refusal = new Error('SQS refused the delete');
    failingCommand(connecting.sqs, { command: 'DeleteMessageCommand', error: refusal, times: 1 });
    const received: Received[] = [];
    await consume(handlersOf(received), {});

    await publisher.publish('OrderCreated', { v1: { orderId: 'o-1' } }, { factId: 'f-1' });

    await until(() => expect(received).toHaveLength(2));
    expect(received.map(({ meta }) => meta.deliveryCount)).toEqual([1, 2]);
    expect(hooked).toEqual([]);
    expect(written).not.toHaveBeenCalled();
  });

  test('consume rejects a queue whose QueueArn is not the one built from the connecting object’s account and region, naming both', async () => {
    const { consume, connecting, orders } = await aMessaging();
    const built = `arn:aws:sqs:eu-west-1:123456789012:${orders.chargeQueue}`;
    const other = `arn:aws:sqs:eu-west-1:210987654321:${orders.chargeQueue}`;
    answeringAttributes(connecting.sqs, { QueueArn: other });

    const consuming = consume(handlersOf([]), {});

    const mismatch = `GetQueueAttributes gave ${other}, not ${built}: 210987654321 is another account than connecting.account 123456789012`;
    await expect(consuming).rejects.toThrow(
      `The queue ${orders.chargeQueue} of the Durable consumer ${orders.chargeDurable} has a QueueArn other than the one built: ${mismatch}: apply the Service's Broker plan`,
    );
  });

  test('consume called again once the queues exist starts consuming', async () => {
    const connecting = anAwsConnecting(moto.url);
    await arrangeTopic(connecting.sns, 'staging_orders-service');
    const started = await messaging(ordersContract, sqs({ ...connecting, prefix: 'staging' }));
    const { sender, consume } = started;
    closedWhenDone(started, connecting);
    const received: Received[] = [];
    await expect(consume(handlersOf(received), {})).rejects.toThrow('has no queue');
    await arrangeOrders(connecting, { prefix: 'staging' });
    await sender.send('ChargeCard', { orderId: 'o-1' }, { factId: 'f-1' });

    await consume(handlersOf(received), {});

    await until(() => expect(received).toHaveLength(1));
  });

  test.each([
    ['without a redrive policy', 'has no RedrivePolicy', setRedriveAway],
    [
      'with a cf-loom:backoff tag it cannot read',
      "has the cf-loom:backoff tag 'soon', which cf-loom cannot read",
      (sqsClient: SQSClient, queue: string) =>
        tagByHand(sqsClient, queue, { 'cf-loom:backoff': 'soon' }),
    ],
    [
      'without a cf-loom:subscription tag',
      'has no cf-loom:subscription tag',
      (sqsClient: SQSClient, queue: string) =>
        untagByHand(sqsClient, queue, ['cf-loom:subscription']),
    ],
  ])(
    'consume rejects naming the queue and the difference of a queue %s, and receives from none',
    async (_, difference, change) => {
      const { sender, consume, connecting, orders } = await aMessaging();
      await change(connecting.sqs, orders.chargeQueue);
      await sender.send('ChargeCard', { orderId: 'o-1' }, { factId: 'f-1' });
      const received: Received[] = [];

      const consuming = consume(handlersOf(received), {});

      await expect(consuming).rejects.toThrow(
        new RegExp(
          `^The queue ${orders.chargeQueue} of the Durable consumer ${orders.chargeDurable} ${difference}: apply the Service's Broker plan$`,
        ),
      );
      await expect(queueCountsOf(connecting.sqs, orders.notifyQueue)).resolves.toEqual({
        visible: 0,
        inFlight: 0,
      });
      await expect(queueCountsOf(connecting.sqs, orders.chargeQueue)).resolves.toEqual({
        visible: 1,
        inFlight: 0,
      });
      expect(received).toEqual([]);
    },
  );

  test.each([
    {
      name: 'a visibility timeout of 0',
      arrange: (sqsClient: SQSClient, queue: string) =>
        setQueueAttributes(sqsClient, queue, { VisibilityTimeout: '0' }),
      difference: "has the VisibilityTimeout '0', which cf-loom cannot read",
    },
    {
      name: 'a negative visibility timeout',
      arrange: (sqsClient: SQSClient, queue: string) =>
        setQueueAttributes(sqsClient, queue, { VisibilityTimeout: '-1' }),
      difference: "has the VisibilityTimeout '-1', which cf-loom cannot read",
    },
    {
      name: 'a visibility timeout of 12 hours',
      arrange: (sqsClient: SQSClient, queue: string) =>
        setQueueAttributes(sqsClient, queue, { VisibilityTimeout: '43200' }),
      difference: "has the VisibilityTimeout '43200', which cf-loom cannot read",
    },
    {
      name: 'a visibility timeout that is not a whole number',
      arrange: (sqsClient: SQSClient) =>
        answeringAttributes(sqsClient, { VisibilityTimeout: '1.5' }),
      difference: "has the VisibilityTimeout '1.5', which cf-loom cannot read",
    },
    {
      name: 'a maxReceiveCount of 0',
      arrange: (sqsClient: SQSClient, queue: string) =>
        setQueueAttributes(sqsClient, queue, { RedrivePolicy: redriveOf(0, queue) }),
      difference: `has the RedrivePolicy '{"deadLetterTargetArn": "${deadLetterArnOf('QUEUE')}", "maxReceiveCount": 0}', whose maxReceiveCount cf-loom cannot read`,
    },
    {
      name: 'a maxReceiveCount of more than 1,000',
      arrange: (sqsClient: SQSClient, queue: string) =>
        setQueueAttributes(sqsClient, queue, { RedrivePolicy: redriveOf(1_001, queue) }),
      difference: `has the RedrivePolicy '{"deadLetterTargetArn": "${deadLetterArnOf('QUEUE')}", "maxReceiveCount": 1001}', whose maxReceiveCount cf-loom cannot read`,
    },
    {
      name: 'a redrive policy with no maxReceiveCount',
      arrange: (sqsClient: SQSClient) =>
        answeringAttributes(sqsClient, { RedrivePolicy: '{"deadLetterTargetArn":"arn"}' }),
      difference: `has the RedrivePolicy '{"deadLetterTargetArn":"arn"}', whose maxReceiveCount cf-loom cannot read`,
    },
    {
      name: 'a redrive policy that is not JSON',
      arrange: (sqsClient: SQSClient) => answeringAttributes(sqsClient, { RedrivePolicy: 'never' }),
      difference: "has the RedrivePolicy 'never', whose maxReceiveCount cf-loom cannot read",
    },
  ])(
    'consume rejects naming the queue and $name as a difference, never with a thrown error',
    async ({ arrange, difference }) => {
      const { consume, connecting, orders } = await aMessaging();
      await arrange(connecting.sqs, orders.chargeQueue);

      const consuming = consume(handlersOf([]), {});

      const line = `The queue ${orders.chargeQueue} of the Durable consumer ${orders.chargeDurable} ${difference.replace('QUEUE', orders.chargeQueue)}: apply the Service's Broker plan`;
      await expect(consuming).rejects.toThrow(line);
    },
  );

  test('consume reads the widest backoff tag, 256 characters of entries, and finds cf-loom’s tags beside the organization’s tags named __proto__, constructor and toString', async () => {
    const connecting = anAwsConnecting(moto.url);
    const widest: Duration[] = [
      '30s',
      ...Array.from({ length: 36 }, (): Duration => '10000s'),
      '999s',
    ];
    await arrangeOrders(connecting, {
      prefix: 'staging',
      limits: {
        durableConsumerDefaults: { ...testLimits.durableConsumerDefaults, ackWait: widest },
      },
    });
    const orders = anOrders('staging');
    for (const queue of [orders.notifyQueue, orders.chargeQueue]) {
      await tagByHand(
        connecting.sqs,
        queue,
        fromJson('{"__proto__":"a","constructor":"b","toString":"c"}'),
      );
    }
    const started = await messaging(ordersContract, sqs({ ...connecting, prefix: 'staging' }));
    closedWhenDone(started, connecting);
    await started.sender.send('ChargeCard', { orderId: 'o-1' }, { factId: 'f-1' });
    const received: Received[] = [];

    await started.consume(handlersOf(received), {});

    await until(() => expect(received).toHaveLength(1));
  });

  describe('a queue’s subscription', () => {
    const chargeFilter = (subject: string) => `{"cf-loom-subject":["${subject}"]}`;

    /** The ARN of the subscription `applyBrokerPlan` tagged the queue with. */
    async function subscriptionOf(sqsClient: SQSClient, queue: string): Promise<string> {
      return (await queueTagsOf(sqsClient, queue))['cf-loom:subscription'] ?? '';
    }

    test.each([
      {
        name: 'a subscription that was deleted',
        arrange: async ({ connecting, orders }: AMessaging) => {
          const arn = await subscriptionOf(connecting.sqs, orders.chargeQueue);
          await unsubscribe(connecting.sns, arn);
          return `has the cf-loom:subscription tag '${arn}', which names no subscription`;
        },
      },
      {
        name: 'text that is no ARN',
        arrange: async ({ connecting, orders }: AMessaging) => {
          await tagByHand(connecting.sqs, orders.chargeQueue, {
            'cf-loom:subscription': 'garbage',
          });
          return "has the cf-loom:subscription tag 'garbage', which names no subscription";
        },
      },
      {
        name: 'raw delivery turned off',
        arrange: async ({ connecting, orders }: AMessaging) => {
          const arn = await subscriptionOf(connecting.sqs, orders.chargeQueue);
          await setSubscriptionAttribute(connecting.sns, arn, {
            name: 'RawMessageDelivery',
            value: 'false',
          });
          return 'its subscription has RawMessageDelivery false, not true';
        },
      },
      {
        name: 'another filter policy',
        arrange: async ({ connecting, orders }: AMessaging) => {
          const arn = await subscriptionOf(connecting.sqs, orders.chargeQueue);
          const other = chargeFilter('staging.orders-service.command.Other.v1');
          await setSubscriptionAttribute(connecting.sns, arn, {
            name: 'FilterPolicy',
            value: other,
          });
          return `its subscription has FilterPolicy ${other}, not ${chargeFilter(orders.charge)}`;
        },
      },
      {
        name: 'another filter policy scope',
        arrange: async ({ connecting, orders }: AMessaging) => {
          const arn = await subscriptionOf(connecting.sqs, orders.chargeQueue);
          await setSubscriptionAttribute(connecting.sns, arn, {
            name: 'FilterPolicyScope',
            value: 'MessageBody',
          });
          return 'its subscription has FilterPolicyScope MessageBody, not MessageAttributes';
        },
      },
      {
        name: 'a subscription of another topic',
        arrange: async ({ connecting, orders }: AMessaging) => {
          const topicArn = await arrangeTopic(connecting.sns, 'another-topic');
          const queueArn = `arn:aws:sqs:eu-west-1:123456789012:${orders.chargeQueue}`;
          const arn = await subscribeByHand(connecting.sns, { topicArn, queueArn });
          const attributes = {
            RawMessageDelivery: 'true',
            FilterPolicy: chargeFilter(orders.charge),
            FilterPolicyScope: 'MessageAttributes',
          };
          for (const [name, value] of Object.entries(attributes)) {
            await setSubscriptionAttribute(connecting.sns, arn, { name, value });
          }
          await tagByHand(connecting.sqs, orders.chargeQueue, { 'cf-loom:subscription': arn });
          const ordersTopic = 'arn:aws:sns:eu-west-1:123456789012:staging_orders-service';
          return `its subscription has TopicArn ${topicArn}, not ${ordersTopic}`;
        },
      },
      {
        name: 'the subscription of another queue',
        arrange: async ({ connecting, orders }: AMessaging) => {
          const notifies = await subscriptionOf(connecting.sqs, orders.notifyQueue);
          await tagByHand(connecting.sqs, orders.chargeQueue, { 'cf-loom:subscription': notifies });
          const [endpoint, filter] = [
            `arn:aws:sqs:eu-west-1:123456789012:${orders.notifyQueue}`,
            chargeFilter(orders.created),
          ];
          return `its subscription has Endpoint ${endpoint}, not arn:aws:sqs:eu-west-1:123456789012:${orders.chargeQueue} and its subscription has FilterPolicy ${filter}, not ${chargeFilter(orders.charge)}`;
        },
      },
    ])('consume rejects naming the queue and the difference of $name', async ({ arrange }) => {
      const messagingOf = await aMessaging();
      const { consume, orders } = messagingOf;
      const difference = await arrange(messagingOf);

      const consuming = consume(handlersOf([]), {});

      const line = `The queue ${orders.chargeQueue} of the Durable consumer ${orders.chargeDurable} ${difference}: apply the Service's Broker plan`;
      await expect(consuming).rejects.toMatchObject({ message: line });
    });

    test('a filter policy equal as JSON but written otherwise is no difference', async () => {
      const messagingOf = await aMessaging();
      const { consume, connecting, orders } = messagingOf;
      const arn = await subscriptionOf(connecting.sqs, orders.chargeQueue);
      const spaced = `{\n  "cf-loom-subject": [ "${orders.charge}" ]\n}`;
      await setSubscriptionAttribute(connecting.sns, arn, { name: 'FilterPolicy', value: spaced });

      const consuming = consume(handlersOf([]), {});

      await expect(consuming).resolves.toBeUndefined();
    });

    test('a subscription applyBrokerPlan left passes the check, run once or again', async () => {
      const { consume, connecting } = await aMessaging();
      await arrangeOrders(connecting, { prefix: 'staging' });

      const consuming = consume(handlersOf([]), {});

      await expect(consuming).resolves.toBeUndefined();
    });
  });
});

/** Removes the redrive policy of a queue, as the organization's tooling would. */
function setRedriveAway(sqsClient: SQSClient, queue: string): Promise<void> {
  return setQueueAttributes(sqsClient, queue, { RedrivePolicy: '' });
}

/** The queue's dead-letter queue's ARN, which a redrive policy set by hand names. */
function deadLetterArnOf(queue: string): string {
  return `arn:aws:sqs:eu-west-1:123456789012:${queue}_dlq`;
}

/** Makes the queue answer `GetQueueAttributes` with these attributes over its own, for what moto does not store. */
function answeringAttributes(sqsClient: SQSClient, attributes: Record<string, string>): void {
  alteringAnswers(sqsClient, 'GetQueueAttributesCommand', (output) => {
    output['Attributes'] = { ...(output['Attributes'] as object), ...attributes };
  });
}

const redriveOf = (maxReceiveCount: number, queue: string) =>
  JSON.stringify({ deadLetterTargetArn: deadLetterArnOf(queue), maxReceiveCount });

/** A tag set as JSON text holds it, so a key such as `__proto__` is an own key of the value. */
function fromJson(text: string): Record<string, string> {
  return JSON.parse(text);
}

/** Whether a console line is one the adapter writes for a Message it left for the dead-letter queue. */
function isLeftLine(line: string): boolean {
  return line.includes(': left SQS message ');
}

/** A message attribute as SQS carries it. */
type RawAttribute = {
  readonly DataType: string;
  readonly StringValue?: string;
  readonly BinaryValue?: Uint8Array;
};

/** A promise a test settles itself, to hold a Handler while it runs; opened when the test ends, so a failing test never leaves a Handler held. */
function aGate() {
  const gate = Promise.withResolvers<undefined>();
  const open = () => gate.resolve(undefined);
  onTestFinished(open);
  return { opened: gate.promise, open };
}
