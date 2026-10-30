// biome-ignore-all lint/style/useNamingConvention: AWS names its fields in PascalCase, as they travel
import type { SQSClient } from '@aws-sdk/client-sqs';
import { handle } from '@cf-loom/handlers';
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
  failingCommand,
} from '../../test/aws-clients.ts';
import { queueCountsOf, queueTagsOf } from '../../test/aws-reading.ts';
import { aMotoServer, type MotoServer } from '../../test/moto-server.ts';
import {
  anOrders,
  arrangeOrders,
  handlersOf,
  ordersContract,
  ordersReaders,
  type Received,
  testLimits,
} from '../../test/orders.ts';
import { until } from '../../test/until.ts';
import { messaging } from '../index.ts';
import { type Duration, type SqsConnecting, sqs } from './index.ts';

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

/** An Orders messaging over sqs() on the test's moto, closed when the test ends, with the names it works with. */
async function aMessaging(prefix: string | null = 'staging') {
  const connecting = anAwsConnecting(moto.url);
  await arrangeOrders(connecting, { prefix });
  const started = await messaging(
    ordersContract,
    sqs(prefix === null ? connecting : { ...connecting, prefix }),
  );
  const orders = anOrders(prefix);
  closedWhenDone(started, connecting, orders);
  return { ...started, connecting, orders };
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
    const { sender, consume } = await aMessaging(null);
    const received: Received[] = [];
    await sender.send('ChargeCard', { orderId: 'o-1' }, { factId: 'f-1' });

    await consume(handlersOf(received), {});

    await until(() => expect(received.map(({ handler }) => handler)).toEqual(['ChargeCard@1']));
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
