// biome-ignore-all lint/style/useNamingConvention: AWS names its fields in PascalCase, as they travel
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import {
  arrangeQueue,
  arrangeTopic,
  publishOn,
  setQueueAttributes,
  setSubscriptionAttribute,
  storeIn,
  subscribeByHand,
  tagByHand,
  unsubscribe,
} from '../../test/aws-arranging.ts';
import {
  aClosedUrl,
  alteringAnswers,
  anAwsConnecting,
  countCommands,
  inAccount,
  recordingInputs,
} from '../../test/aws-clients.ts';
import {
  queueAttributesOf,
  queueNamesOf,
  queueTagsOf,
  receivedFrom,
  subscriptionAttributesOf,
  subscriptionsOf,
  topicNamesOf,
} from '../../test/aws-reading.ts';
import { aServiceOfLongestNames, planOf } from '../../test/broker-plans.ts';
import { aMotoServer, type MotoServer } from '../../test/moto-server.ts';
import { applyBrokerPlan, type BrokerPlan, type Duration, type SqsBrokerLimits } from './index.ts';

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

/** Every setting a Durable consumer's queue needs. */
const testLimits: SqsBrokerLimits = {
  durableConsumerDefaults: {
    ackWait: '30s',
    maxDeliver: 5,
    retention: '4d',
    deadLetterRetention: '14d',
  },
};

function named(prefix: string | null, name: string): string {
  return prefix === null ? name : `${prefix}_${name}`;
}

function subjectNamed(prefix: string | null, subject: string): string {
  return prefix === null ? subject : `${prefix}.${subject}`;
}

/** The names and subjects of Orders’ plan under a prefix, and the plan itself. */
function anOrders(prefix: string | null = null) {
  const stream = named(prefix, 'orders-service');
  const created = subjectNamed(prefix, 'orders-service.event.OrderCreated.v1');
  const charge = subjectNamed(prefix, 'orders-service.command.ChargeCard.v1');
  const chargeDurable = named(prefix, 'orders-service_command_ChargeCard_v1');
  const plan: BrokerPlan = {
    prefix,
    streams: { [stream]: { service: 'orders-service', subjects: [charge, created] } },
    durableConsumers: {
      [chargeDurable]: { service: 'orders-service', stream, subject: charge },
    },
  };
  return { stream, created, charge, chargeDurable, plan };
}

/** Billing’s plan under a prefix: no stream, and one Durable consumer on Orders’ stream. */
function aBilling(prefix: string | null = null) {
  const orders = anOrders(prefix);
  const durable = named(prefix, 'billing-service_draft-invoice-on-created');
  const plan: BrokerPlan = {
    prefix,
    streams: {},
    durableConsumers: {
      [durable]: { service: 'billing-service', stream: orders.stream, subject: orders.created },
    },
  };
  return { durable, plan, orders };
}

/** A seeded generator of the same sequence every run, so a failing sequence can be replayed. */
function seededNext(seed: number): () => number {
  let state = seed;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

/** A plan of Durable consumers on one Stream with exactly the given names, all of one Service. */
function aPlanOfDurables(names: readonly string[]): BrokerPlan {
  const subject = 'long.event.E.v1';
  const durableConsumers = Object.fromEntries(
    names.map((name) => [name, { service: 'long', stream: 'long', subject }]),
  );
  return {
    prefix: null,
    streams: { long: { service: 'long', subjects: [subject] } },
    durableConsumers,
  };
}

/** Limits as a Service reads them from a JSON file, so a test can write a value the types refuse. */
function readFromJson(limits: unknown): SqsBrokerLimits {
  return JSON.parse(JSON.stringify(limits));
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

/** Ack waits whose backoff text is 36 of `10000s`, a space and `last`: 256 characters for `999s`, 257 for `9999s`. */
function backoffOf(last: Duration): Duration[] {
  return ['30s', ...Array.from({ length: 36 }, (): Duration => '10000s'), last];
}

function sqsArnOf(queue: string): string {
  return `arn:aws:sqs:eu-west-1:123456789012:${queue}`;
}

function snsArnOf(topic: string): string {
  return `arn:aws:sns:eu-west-1:123456789012:${topic}`;
}

describe('applyBrokerPlan', () => {
  test('applyBrokerPlan creates the Service’s own Stream as an SNS topic named as the plan prints it', async () => {
    const orders = anOrders('staging');
    const connecting = anAwsConnecting(moto.url);

    await applyBrokerPlan(connecting, orders.plan, testLimits);

    expect(await topicNamesOf(connecting.sns)).toEqual(['staging_orders-service']);
  });

  test('applyBrokerPlan creates each Durable consumer’s queue with its visibility timeout, retention, and the tags cf-loom:durable and cf-loom:service', async () => {
    const orders = anOrders('staging');
    const connecting = anAwsConnecting(moto.url);

    await applyBrokerPlan(connecting, orders.plan, testLimits);

    const attributes = await queueAttributesOf(connecting.sqs, orders.chargeDurable);
    const tags = await queueTagsOf(connecting.sqs, orders.chargeDurable);
    expect(attributes).toMatchObject({ VisibilityTimeout: '30', MessageRetentionPeriod: '345600' });
    expect(tags).toMatchObject({
      'cf-loom:durable': 'staging_orders-service_command_ChargeCard_v1',
      'cf-loom:service': 'orders-service',
    });
  });

  test('a list of ack waits gives the queue the first as its visibility timeout and the rest, as written, in its cf-loom:backoff tag', async () => {
    const orders = anOrders();
    const connecting = anAwsConnecting(moto.url);
    const backoff: SqsBrokerLimits = {
      durableConsumerDefaults: {
        ...testLimits.durableConsumerDefaults,
        ackWait: ['30s', '1m', '5m'],
      },
    };

    await applyBrokerPlan(connecting, orders.plan, backoff);

    const attributes = await queueAttributesOf(connecting.sqs, orders.chargeDurable);
    const tags = await queueTagsOf(connecting.sqs, orders.chargeDurable);
    expect(attributes['VisibilityTimeout']).toBe('30');
    expect(tags['cf-loom:backoff']).toBe('1m 5m');
  });

  test('one ack wait gives the queue no cf-loom:backoff tag', async () => {
    const orders = anOrders();
    const connecting = anAwsConnecting(moto.url);

    await applyBrokerPlan(connecting, orders.plan, testLimits);

    const tags = await queueTagsOf(connecting.sqs, orders.chargeDurable);
    expect(Object.keys(tags)).not.toContain('cf-loom:backoff');
  });

  test('each queue gets its _dlq dead-letter queue, tagged with its queue’s cf-loom:durable and cf-loom:service and no backoff, with deadLetterRetention, and a redrive policy of that many receives', async () => {
    const orders = anOrders();
    const connecting = anAwsConnecting(moto.url);
    const backoff: SqsBrokerLimits = {
      durableConsumerDefaults: { ...testLimits.durableConsumerDefaults, ackWait: ['30s', '1m'] },
    };
    const deadLetterQueue = `${orders.chargeDurable}_dlq`;

    await applyBrokerPlan(connecting, orders.plan, backoff);

    const deadLetterAttributes = await queueAttributesOf(connecting.sqs, deadLetterQueue);
    const tags = await queueTagsOf(connecting.sqs, deadLetterQueue);
    const queueAttributes = await queueAttributesOf(connecting.sqs, orders.chargeDurable);
    expect(deadLetterAttributes['MessageRetentionPeriod']).toBe('1209600');
    expect(tags).toEqual({
      'cf-loom:durable': orders.chargeDurable,
      'cf-loom:service': 'orders-service',
    });
    expect(JSON.parse(queueAttributes['RedrivePolicy'] ?? '{}')).toEqual({
      deadLetterTargetArn: sqsArnOf(deadLetterQueue),
      maxReceiveCount: 5,
    });
  });

  test('without a prefix, applyBrokerPlan creates the names the plan prints, unprefixed', async () => {
    const orders = anOrders(null);
    const connecting = anAwsConnecting(moto.url);

    await applyBrokerPlan(connecting, orders.plan, testLimits);

    expect(await topicNamesOf(connecting.sns)).toEqual(['orders-service']);
    expect(await queueNamesOf(connecting.sqs)).toEqual([
      'orders-service_command_ChargeCard_v1',
      'orders-service_command_ChargeCard_v1_dlq',
    ]);
  });

  test('a Durable consumer’s own limits override the defaults setting by setting', async () => {
    const orders = anOrders();
    const connecting = anAwsConnecting(moto.url);
    const limits: SqsBrokerLimits = {
      ...testLimits,
      durableConsumers: { [orders.chargeDurable]: { ackWait: ['2m', '5m'], maxDeliver: 9 } },
    };

    await applyBrokerPlan(connecting, orders.plan, limits);

    const attributes = await queueAttributesOf(connecting.sqs, orders.chargeDurable);
    const tags = await queueTagsOf(connecting.sqs, orders.chargeDurable);
    expect(attributes).toMatchObject({
      VisibilityTimeout: '120',
      MessageRetentionPeriod: '345600',
    });
    expect(JSON.parse(attributes['RedrivePolicy'] ?? '{}').maxReceiveCount).toBe(9);
    expect(tags['cf-loom:backoff']).toBe('5m');
  });

  test('each queue is tagged cf-loom:subscription with the ARN of its subscription, whose attributes are the shape consume checks', async () => {
    const orders = anOrders('staging');
    const connecting = anAwsConnecting(moto.url);

    await applyBrokerPlan(connecting, orders.plan, testLimits);

    const tags = await queueTagsOf(connecting.sqs, orders.chargeDurable);
    const attributes = await subscriptionAttributesOf(
      connecting.sns,
      tags['cf-loom:subscription'] ?? '',
    );
    expect(attributes).toMatchObject({
      RawMessageDelivery: 'true',
      FilterPolicy: JSON.stringify({ 'cf-loom-subject': [orders.charge] }),
      FilterPolicyScope: 'MessageAttributes',
      TopicArn: snsArnOf(orders.stream),
      Endpoint: sqsArnOf(orders.chargeDurable),
    });
  });

  test('each queue is subscribed to its Stream’s topic with raw delivery and a filter on the plan’s subject', async () => {
    const orders = anOrders();
    const connecting = anAwsConnecting(moto.url);

    await applyBrokerPlan(connecting, orders.plan, testLimits);

    const subscriptions = await subscriptionsOf(connecting.sns, snsArnOf(orders.stream));
    expect(subscriptions).toHaveLength(1);
    expect(subscriptions[0]).toMatchObject({
      protocol: 'sqs',
      endpoint: sqsArnOf(orders.chargeDurable),
    });
    const attributes = await subscriptionAttributesOf(connecting.sns, subscriptions[0]?.arn ?? '');
    expect(attributes['RawMessageDelivery']).toBe('true');
    expect(JSON.parse(attributes['FilterPolicy'] ?? '{}')).toEqual({
      'cf-loom-subject': [orders.charge],
    });
  });

  test('a Message published on the topic with the plan’s subject in cf-loom-subject reaches the queue raw, and one with another subject does not', async () => {
    const orders = anOrders();
    const connecting = anAwsConnecting(moto.url);
    await applyBrokerPlan(connecting, orders.plan, testLimits);

    await publishOn(connecting.sns, snsArnOf(orders.stream), {
      subject: orders.charge,
      body: '{"orderId":"1"}',
    });
    await publishOn(connecting.sns, snsArnOf(orders.stream), {
      subject: orders.created,
      body: '{"orderId":"2"}',
    });

    expect(await receivedFrom(connecting.sqs, orders.chargeDurable)).toEqual([
      { body: '{"orderId":"1"}', subject: orders.charge },
    ]);
  });

  test('the queue’s policy lets its Stream’s topic send to it, in one statement named cf-loom-topic', async () => {
    const orders = anOrders();
    const connecting = anAwsConnecting(moto.url);

    await applyBrokerPlan(connecting, orders.plan, testLimits);

    const attributes = await queueAttributesOf(connecting.sqs, orders.chargeDurable);
    const policy = JSON.parse(attributes['Policy'] ?? '{}');
    expect(policy.Statement).toEqual([
      {
        Sid: 'cf-loom-topic',
        Effect: 'Allow',
        Principal: { Service: 'sns.amazonaws.com' },
        Action: 'sqs:SendMessage',
        Resource: sqsArnOf(orders.chargeDurable),
        Condition: { ArnEquals: { 'aws:SourceArn': snsArnOf(orders.stream) } },
      },
    ]);
  });

  test('a Durable consumer of a Provider’s Stream subscribes to the Provider’s existing topic', async () => {
    const billing = aBilling();
    const connecting = anAwsConnecting(moto.url);
    const providerTopic = await arrangeTopic(connecting.sns, billing.orders.stream);

    await applyBrokerPlan(connecting, billing.plan, testLimits);

    const subscriptions = await subscriptionsOf(connecting.sns, providerTopic);
    expect(subscriptions.map(({ endpoint }) => endpoint)).toEqual([sqsArnOf(billing.durable)]);
    expect(await topicNamesOf(connecting.sns)).toEqual([billing.orders.stream]);
  });

  test('a Command’s Durable consumer reads the Service’s own topic as a Subscription’s does', async () => {
    const orders = anOrders();
    const connecting = anAwsConnecting(moto.url);

    await applyBrokerPlan(connecting, orders.plan, testLimits);

    const [subscription] = await subscriptionsOf(connecting.sns, snsArnOf(orders.stream));
    const attributes = await subscriptionAttributesOf(connecting.sns, subscription?.arn ?? '');
    expect(JSON.parse(attributes['FilterPolicy'] ?? '{}')).toEqual({
      'cf-loom-subject': [orders.charge],
    });
  });

  test('applyBrokerPlan applies the plan of the longest names the grammars accept, under the longest prefix, each queue name within 80 characters and each cf-loom:subscription tag the whole subscription ARN', async () => {
    const { contract, prefix } = aServiceOfLongestNames();
    const plan = planOf(contract, prefix);
    const [stream = ''] = Object.keys(plan.streams);
    const connecting = anAwsConnecting(moto.url);

    await applyBrokerPlan(connecting, plan, testLimits);

    const queues = await queueNamesOf(connecting.sqs);
    const subscriptions = await subscriptionsOf(connecting.sns, snsArnOf(stream));
    const tagged = await Promise.all(
      queues
        .filter((queue) => !queue.endsWith('_dlq'))
        .map((queue) => queueTagsOf(connecting.sqs, queue)),
    );
    expect(queues).toHaveLength(4);
    expect(Math.max(...queues.map((queue) => queue.length))).toBeLessThanOrEqual(80);
    expect(tagged.map((tags) => tags['cf-loom:subscription']).sort()).toEqual(
      subscriptions.map(({ arn }) => arn).sort(),
    );
    const topicArnLength = `${snsArnOf(stream)}:`.length;
    expect(subscriptions.map(({ arn }) => arn.length)).toEqual([
      topicArnLength + 36,
      topicArnLength + 36,
    ]);
  });

  test('every Durable consumer of a plan of long names sharing their first 63 characters gets queues of its own, found by its cf-loom:durable tag', async () => {
    const next = seededNext(477);
    const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789_-';
    const head = `${'h'.repeat(62)}_`;
    const tailOf = (length: number) =>
      Array.from({ length }, () => alphabet[Math.floor(next() * alphabet.length)]).join('');
    const lengths = [1, 2, 63, 64, 75, 76, 77, 78, 79, 80, 224, 225];
    const randomLengths = Array.from({ length: 28 }, () => 1 + Math.floor(next() * 225));
    const names = [
      ...new Set(
        [...lengths, ...randomLengths].map((length) => `${head}${tailOf(225)}`.slice(0, length)),
      ),
    ];
    const plan = aPlanOfDurables(names);
    const connecting = anAwsConnecting(moto.url);

    await applyBrokerPlan(connecting, plan, testLimits);

    const queues = await queueNamesOf(connecting.sqs);
    const tagsByQueue = new Map(
      await Promise.all(
        queues.map(async (queue) => [queue, await queueTagsOf(connecting.sqs, queue)] as const),
      ),
    );
    const queueOf = (durable: string) =>
      [...tagsByQueue].filter(
        ([queue, tags]) => tags['cf-loom:durable'] === durable && !queue.endsWith('_dlq'),
      );
    expect(queues).toHaveLength(names.length * 2);
    expect(Math.max(...queues.map((queue) => queue.length))).toBeLessThanOrEqual(80);
    for (const name of names) {
      const [found, ...others] = queueOf(name);
      expect(others).toEqual([]);
      const queue = found?.[0] ?? '';
      expect(name.length <= 76 ? queue === name : queue.length === 76).toBe(true);
      expect(queue.startsWith(name.slice(0, 63))).toBe(true);
      expect(queues).toContain(`${queue}_dlq`);
    }
  });

  test('Subscriptions notify and notifyDlq get four distinct queues, two of them dead-letter queues', async () => {
    const subject = 'billing-service.event.E.v1';
    const plan: BrokerPlan = {
      prefix: null,
      streams: { 'billing-service': { service: 'billing-service', subjects: [subject] } },
      durableConsumers: {
        'billing-service_notify': {
          service: 'billing-service',
          stream: 'billing-service',
          subject,
        },
        'billing-service_notify-dlq': {
          service: 'billing-service',
          stream: 'billing-service',
          subject,
        },
      },
    };
    const connecting = anAwsConnecting(moto.url);

    await applyBrokerPlan(connecting, plan, testLimits);

    expect(await queueNamesOf(connecting.sqs)).toEqual(
      [
        'billing-service_notify-dlq',
        'billing-service_notify-dlq_dlq',
        'billing-service_notify_dlq',
        'billing-service_notify',
      ].sort(),
    );
    const tags = await queueTagsOf(connecting.sqs, 'billing-service_notify_dlq');
    expect(tags['cf-loom:durable']).toBe('billing-service_notify');
  });

  test('applying again with other limits updates the visibility timeout, retention, backoff tag and redrive count, and keeps the queue attributes limits has no name for', async () => {
    const orders = anOrders();
    const connecting = anAwsConnecting(moto.url);
    await applyBrokerPlan(connecting, orders.plan, testLimits);
    await setQueueAttributes(connecting.sqs, orders.chargeDurable, {
      DelaySeconds: '7',
      MaximumMessageSize: '2048',
    });
    const other: SqsBrokerLimits = {
      durableConsumerDefaults: {
        ackWait: ['45s', '2m'],
        maxDeliver: 8,
        retention: '2d',
        deadLetterRetention: '10d',
      },
    };

    await applyBrokerPlan(connecting, orders.plan, other);

    const attributes = await queueAttributesOf(connecting.sqs, orders.chargeDurable);
    const tags = await queueTagsOf(connecting.sqs, orders.chargeDurable);
    const deadLetter = await queueAttributesOf(connecting.sqs, `${orders.chargeDurable}_dlq`);
    expect(attributes).toMatchObject({
      VisibilityTimeout: '45',
      MessageRetentionPeriod: '172800',
      DelaySeconds: '7',
      MaximumMessageSize: '2048',
    });
    expect(JSON.parse(attributes['RedrivePolicy'] ?? '{}').maxReceiveCount).toBe(8);
    expect(tags['cf-loom:backoff']).toBe('2m');
    expect(deadLetter['MessageRetentionPeriod']).toBe('864000');
  });

  test('a backoff list that becomes one wait removes the queue’s backoff tag', async () => {
    const orders = anOrders();
    const connecting = anAwsConnecting(moto.url);
    const backoff: SqsBrokerLimits = {
      durableConsumerDefaults: { ...testLimits.durableConsumerDefaults, ackWait: ['30s', '1m'] },
    };
    await applyBrokerPlan(connecting, orders.plan, backoff);

    await applyBrokerPlan(connecting, orders.plan, testLimits);

    const tags = await queueTagsOf(connecting.sqs, orders.chargeDurable);
    expect(Object.keys(tags).sort()).toEqual([
      'cf-loom:durable',
      'cf-loom:service',
      'cf-loom:subscription',
    ]);
  });

  test('a changed maxDeliver updates the redrive policy’s count and keeps the dead-letter queue and what it holds', async () => {
    const orders = anOrders();
    const connecting = anAwsConnecting(moto.url);
    const deadLetterQueue = `${orders.chargeDurable}_dlq`;
    await applyBrokerPlan(connecting, orders.plan, testLimits);
    await storeIn(connecting.sqs, deadLetterQueue, 'parked');

    await applyBrokerPlan(connecting, orders.plan, {
      durableConsumerDefaults: { ...testLimits.durableConsumerDefaults, maxDeliver: 12 },
    });

    const attributes = await queueAttributesOf(connecting.sqs, orders.chargeDurable);
    const deadLetter = await queueAttributesOf(connecting.sqs, deadLetterQueue);
    expect(JSON.parse(attributes['RedrivePolicy'] ?? '{}')).toEqual({
      deadLetterTargetArn: sqsArnOf(deadLetterQueue),
      maxReceiveCount: 12,
    });
    expect(deadLetter['ApproximateNumberOfMessages']).toBe('1');
  });

  test.each([
    ['a list holding a stale cf-loom-topic statement', 'list'],
    ['one object', 'object'],
  ] as const)(
    'applyBrokerPlan replaces the cf-loom-topic statement of an existing queue policy and keeps the organization’s other statements, held as %s',
    async (_held, form) => {
      const orders = anOrders();
      const connecting = anAwsConnecting(moto.url);
      const organizations = {
        Sid: 'organization',
        Effect: 'Allow',
        Principal: { AWS: 'arn:aws:iam::123456789012:root' },
        Action: 'sqs:ReceiveMessage',
        Resource: sqsArnOf(orders.chargeDurable),
      };
      const stale = { ...organizations, Sid: 'cf-loom-topic', Action: 'sqs:DeleteMessage' };
      const Statement = form === 'list' ? [organizations, stale] : organizations;
      const Policy = JSON.stringify({ Version: '2012-10-17', Statement });
      await arrangeQueue(connecting.sqs, orders.chargeDurable, { attributes: { Policy } });

      await applyBrokerPlan(connecting, orders.plan, testLimits);

      const attributes = await queueAttributesOf(connecting.sqs, orders.chargeDurable);
      const statements = JSON.parse(attributes['Policy'] ?? '{}').Statement;
      expect(statements.map((statement: { Sid: string }) => statement.Sid)).toEqual([
        'organization',
        'cf-loom-topic',
      ]);
      expect(statements[1].Action).toBe('sqs:SendMessage');
    },
  );

  test('applying an existing subscription again restores raw delivery, the filter and its scope changed by hand', async () => {
    const orders = anOrders();
    const connecting = anAwsConnecting(moto.url);
    await applyBrokerPlan(connecting, orders.plan, testLimits);
    const before = await queueTagsOf(connecting.sqs, orders.chargeDurable);
    const arn = before['cf-loom:subscription'] ?? '';
    const byHand = [
      { name: 'RawMessageDelivery', value: 'false' },
      { name: 'FilterPolicy', value: '{"cf-loom-subject":["other"]}' },
      { name: 'FilterPolicyScope', value: 'MessageBody' },
    ];
    for (const attribute of byHand) {
      await setSubscriptionAttribute(connecting.sns, arn, attribute);
    }

    await applyBrokerPlan(connecting, orders.plan, testLimits);

    const attributes = await subscriptionAttributesOf(connecting.sns, arn);
    const subscriptions = await subscriptionsOf(connecting.sns, snsArnOf(orders.stream));
    expect(attributes).toMatchObject({
      RawMessageDelivery: 'true',
      FilterPolicyScope: 'MessageAttributes',
    });
    expect(JSON.parse(attributes['FilterPolicy'] ?? '{}')).toEqual({
      'cf-loom-subject': [orders.charge],
    });
    expect(subscriptions.map((subscription) => subscription.arn)).toEqual([arn]);
  });

  test('applying again adds the filter and its scope to a subscription made by hand with no filter, and creates no second subscription', async () => {
    const orders = anOrders();
    const connecting = anAwsConnecting(moto.url);
    const topicArn = snsArnOf(orders.stream);
    await applyBrokerPlan(connecting, orders.plan, testLimits);
    const [ours] = await subscriptionsOf(connecting.sns, topicArn);
    await unsubscribe(connecting.sns, ours?.arn ?? '');
    const byHand = await subscribeByHand(connecting.sns, {
      topicArn,
      queueArn: sqsArnOf(orders.chargeDurable),
    });

    await applyBrokerPlan(connecting, orders.plan, testLimits);

    const subscriptions = await subscriptionsOf(connecting.sns, topicArn);
    const attributes = await subscriptionAttributesOf(connecting.sns, byHand);
    const tags = await queueTagsOf(connecting.sqs, orders.chargeDurable);
    expect(subscriptions.map((subscription) => subscription.arn)).toEqual([byHand]);
    expect(attributes).toMatchObject({
      RawMessageDelivery: 'true',
      FilterPolicyScope: 'MessageAttributes',
    });
    expect(JSON.parse(attributes['FilterPolicy'] ?? '{}')).toEqual({
      'cf-loom-subject': [orders.charge],
    });
    expect(tags['cf-loom:subscription']).toBe(byHand);
  });

  test('a second apply with nothing changed sets no subscription attribute', async () => {
    const orders = anOrders();
    const connecting = anAwsConnecting(moto.url);
    await applyBrokerPlan(connecting, orders.plan, testLimits);
    const settings = countCommands(connecting.sns, 'SetSubscriptionAttributesCommand');

    await applyBrokerPlan(connecting, orders.plan, testLimits);

    expect(settings.sent()).toBe(0);
  });

  test('an existing subscription whose filter policy is the same JSON written otherwise is left as it is', async () => {
    const orders = anOrders();
    const connecting = anAwsConnecting(moto.url);
    await applyBrokerPlan(connecting, orders.plan, testLimits);
    const tags = await queueTagsOf(connecting.sqs, orders.chargeDurable);
    const filterPolicy = {
      name: 'FilterPolicy',
      value: `{ "cf-loom-subject": [ "${orders.charge}" ] }`,
    };
    await setSubscriptionAttribute(
      connecting.sns,
      tags['cf-loom:subscription'] ?? '',
      filterPolicy,
    );
    const settings = countCommands(connecting.sns, 'SetSubscriptionAttributesCommand');

    await applyBrokerPlan(connecting, orders.plan, testLimits);

    expect(settings.sent()).toBe(0);
  });

  test('applyBrokerPlan never removes a topic, queue, dead-letter queue, subscription or organization’s tag that the plan it applies does not list', async () => {
    const orders = anOrders();
    const refund = 'orders-service_command_Refund_v1';
    const refundSubject = 'orders-service.command.Refund.v1';
    const earlier: BrokerPlan = {
      ...orders.plan,
      durableConsumers: {
        ...orders.plan.durableConsumers,
        [refund]: { service: 'orders-service', stream: orders.stream, subject: refundSubject },
      },
    };
    const connecting = anAwsConnecting(moto.url);
    await arrangeTopic(connecting.sns, 'unrelated');
    await applyBrokerPlan(connecting, earlier, testLimits);
    await tagByHand(connecting.sqs, orders.chargeDurable, { team: 'orders' });

    await applyBrokerPlan(connecting, orders.plan, testLimits);

    const subscriptions = await subscriptionsOf(connecting.sns, snsArnOf(orders.stream));
    const tags = await queueTagsOf(connecting.sqs, orders.chargeDurable);
    expect(await topicNamesOf(connecting.sns)).toEqual(['orders-service', 'unrelated']);
    expect(await queueNamesOf(connecting.sqs)).toEqual(
      [orders.chargeDurable, `${orders.chargeDurable}_dlq`, refund, `${refund}_dlq`].sort(),
    );
    expect(subscriptions.map(({ endpoint }) => endpoint).sort()).toEqual(
      [sqsArnOf(orders.chargeDurable), sqsArnOf(refund)].sort(),
    );
    expect(tags['team']).toBe('orders');
  });

  test('a queue that exists without cf-loom’s tags gets them, and the organization’s tags stay', async () => {
    const orders = anOrders();
    const connecting = anAwsConnecting(moto.url);
    await arrangeQueue(connecting.sqs, orders.chargeDurable, { tags: { team: 'orders' } });

    await applyBrokerPlan(connecting, orders.plan, testLimits);

    const tags = await queueTagsOf(connecting.sqs, orders.chargeDurable);
    expect(tags).toMatchObject({
      team: 'orders',
      'cf-loom:durable': orders.chargeDurable,
      'cf-loom:service': 'orders-service',
    });
  });

  test('applying the same plan twice leaves the topics, queues, subscriptions and stored Messages as the first left them', async () => {
    const orders = anOrders();
    const connecting = anAwsConnecting(moto.url);
    const queues = [orders.chargeDurable, `${orders.chargeDurable}_dlq`];
    await applyBrokerPlan(connecting, orders.plan, testLimits);
    for (const queue of queues) {
      await storeIn(connecting.sqs, queue, `stored in ${queue}`);
    }
    const stateOf = async () => ({
      topics: await topicNamesOf(connecting.sns),
      queues: await queueNamesOf(connecting.sqs),
      subscriptions: await subscriptionsOf(connecting.sns, snsArnOf(orders.stream)),
      stored: await Promise.all(
        queues.map(async (queue) => {
          const attributes = await queueAttributesOf(connecting.sqs, queue);
          return attributes['ApproximateNumberOfMessages'];
        }),
      ),
    });
    const first = await stateOf();

    await applyBrokerPlan(connecting, orders.plan, testLimits);

    expect(await stateOf()).toEqual(first);
    expect(first.stored).toEqual(['1', '1']);
  });

  test('applyBrokerPlan refuses a plan whose shape is not the documented one, creating nothing', async () => {
    const connecting = anAwsConnecting(moto.url);
    const notAPlan = { prefix: null, streams: [], durableConsumers: {} } as unknown as BrokerPlan;

    const error = await rejectionOf(applyBrokerPlan(connecting, notAPlan, testLimits));

    expect(error.message).toMatch(
      /^The value is not the Broker plan of the document cf-loom broker-plan --json prints: /,
    );
    expect(await topicNamesOf(connecting.sns)).toEqual([]);
    expect(await queueNamesOf(connecting.sqs)).toEqual([]);
  });

  test('applyBrokerPlan refuses every setting left unset, naming each Durable consumer and the setting, creating nothing', async () => {
    const billing = aBilling();
    const both: BrokerPlan = {
      ...billing.plan,
      durableConsumers: {
        ...billing.plan.durableConsumers,
        ...anOrders().plan.durableConsumers,
      },
    };
    const connecting = anAwsConnecting(moto.url);
    const limits: SqsBrokerLimits = {
      durableConsumerDefaults: { ackWait: '30s' },
      durableConsumers: { [anOrders().chargeDurable]: { maxDeliver: 3 } },
    };

    const error = await rejectionOf(applyBrokerPlan(connecting, both, limits));

    expect(error.message.split('\n')).toEqual([
      `The Durable consumer ${billing.durable} has no maxDeliver, retention, deadLetterRetention in limits.durableConsumers or limits.durableConsumerDefaults`,
      `The Durable consumer ${anOrders().chargeDurable} has no retention, deadLetterRetention in limits.durableConsumers or limits.durableConsumerDefaults`,
    ]);
    expect(await queueNamesOf(connecting.sqs)).toEqual([]);
  });

  test('a maxDeliver of unlimited, which SQS cannot hold without a dead-letter queue, is refused naming where it is in limits, creating nothing', async () => {
    const orders = anOrders();
    const connecting = anAwsConnecting(moto.url);
    const limits = readFromJson({
      durableConsumerDefaults: { ...testLimits.durableConsumerDefaults, maxDeliver: 'unlimited' },
    });

    const error = await rejectionOf(applyBrokerPlan(connecting, orders.plan, limits));

    expect(error.message).toBe(
      "limits.durableConsumerDefaults.maxDeliver 'unlimited' is not a whole number from 1 to 1000",
    );
    expect(await topicNamesOf(connecting.sns)).toEqual([]);
  });

  test.each([
    ['streamDefaults', { maxAge: '7d' }],
    ['streams', { 'orders-service': { replicas: 1 } }],
    ['other', {}],
  ])(
    'applyBrokerPlan refuses limits with the key %s, which SqsBrokerLimits does not define, naming it, creating nothing',
    async (key, value) => {
      const orders = anOrders();
      const connecting = anAwsConnecting(moto.url);
      const limits = readFromJson({ ...testLimits, [key]: value });

      const error = await rejectionOf(applyBrokerPlan(connecting, orders.plan, limits));

      expect(error.message).toBe(`limits.${key} is a key SqsBrokerLimits does not define`);
      expect(await topicNamesOf(connecting.sns)).toEqual([]);
    },
  );

  test('applyBrokerPlan refuses a setting a Durable consumer has on JetStream and not on SNS/SQS, in the defaults or in one Durable consumer’s own limits, naming each', async () => {
    const orders = anOrders();
    const connecting = anAwsConnecting(moto.url);
    const limits = readFromJson({
      durableConsumerDefaults: { ...testLimits.durableConsumerDefaults, deliverPolicy: 'all' },
      durableConsumers: { [orders.chargeDurable]: { maxAckPending: 10 } },
    });

    const error = await rejectionOf(applyBrokerPlan(connecting, orders.plan, limits));

    expect(error.message.split('\n').sort()).toEqual(
      [
        'limits.durableConsumerDefaults.deliverPolicy is a key SqsBrokerLimits does not define',
        `limits.durableConsumers.${orders.chargeDurable}.maxAckPending is a key SqsBrokerLimits does not define`,
      ].sort(),
    );
    expect(await topicNamesOf(connecting.sns)).toEqual([]);
  });

  test('applyBrokerPlan refuses a duration that is not whole seconds, an ack wait of 12h or more, a retention outside 1m to 14d and a maxDeliver outside 1 to 1000, naming where each is in limits, creating nothing', async () => {
    const orders = anOrders();
    const connecting = anAwsConnecting(moto.url);
    const limits = readFromJson({
      durableConsumerDefaults: {
        ackWait: '1500ms',
        maxDeliver: 1001,
        retention: '30s',
        deadLetterRetention: '15d',
      },
      durableConsumers: { [orders.chargeDurable]: { ackWait: ['30s', '12h'], maxDeliver: 0 } },
    });
    const ackWait =
      'a duration of whole seconds under 12h such as 30s or 5m, or a list of them whose entries after the first take at most 256 characters, joined by a space';
    const retention = 'a duration of whole seconds from 1m to 14d';
    const maxDeliver = 'a whole number from 1 to 1000';

    const error = await rejectionOf(applyBrokerPlan(connecting, orders.plan, limits));

    expect(error.message.split('\n').sort()).toEqual(
      [
        `limits.durableConsumerDefaults.ackWait '1500ms' is not ${ackWait}`,
        `limits.durableConsumerDefaults.maxDeliver 1001 is not ${maxDeliver}`,
        `limits.durableConsumerDefaults.retention '30s' is not ${retention}`,
        `limits.durableConsumerDefaults.deadLetterRetention '15d' is not ${retention}`,
        `limits.durableConsumers.${orders.chargeDurable}.ackWait [ '30s', '12h' ] is not ${ackWait}`,
        `limits.durableConsumers.${orders.chargeDurable}.maxDeliver 0 is not ${maxDeliver}`,
      ].sort(),
    );
    expect(await topicNamesOf(connecting.sns)).toEqual([]);
  });

  test('applyBrokerPlan accepts the bounds of each range', async () => {
    const orders = anOrders();
    const connecting = anAwsConnecting(moto.url);
    const limits: SqsBrokerLimits = {
      durableConsumerDefaults: {
        ackWait: ['1s', '43199s'],
        maxDeliver: 1000,
        retention: '1m',
        deadLetterRetention: '14d',
      },
      durableConsumers: { [orders.chargeDurable]: { maxDeliver: 1, retention: '14d' } },
    };

    await applyBrokerPlan(connecting, orders.plan, limits);

    expect(await queueNamesOf(connecting.sqs)).toHaveLength(2);
  });

  test('a backoff whose tag has exactly 256 characters is accepted', async () => {
    const orders = anOrders();
    const connecting = anAwsConnecting(moto.url);

    await applyBrokerPlan(connecting, orders.plan, {
      durableConsumerDefaults: {
        ...testLimits.durableConsumerDefaults,
        ackWait: backoffOf('999s'),
      },
    });

    const tags = await queueTagsOf(connecting.sqs, orders.chargeDurable);
    expect(tags['cf-loom:backoff']).toHaveLength(256);
  });

  test('a backoff whose tag would exceed 256 characters is refused, naming where that ackWait is in limits, creating nothing', async () => {
    const orders = anOrders();
    const connecting = anAwsConnecting(moto.url);

    const error = await rejectionOf(
      applyBrokerPlan(connecting, orders.plan, {
        durableConsumerDefaults: {
          ...testLimits.durableConsumerDefaults,
          ackWait: backoffOf('9999s'),
        },
      }),
    );

    expect(error.message).toMatch(/^limits\.durableConsumerDefaults\.ackWait \[/);
    expect(error.message).toContain('at most 256 characters');
    expect(await topicNamesOf(connecting.sns)).toEqual([]);
  });

  test.each(['59s', '1209601s'] as const)(
    'a retention or dead-letter retention of %s, outside 1m to 14d by one second, is refused',
    async (outside) => {
      const orders = anOrders();
      const connecting = anAwsConnecting(moto.url);
      const limits: SqsBrokerLimits = {
        durableConsumerDefaults: {
          ...testLimits.durableConsumerDefaults,
          retention: outside,
          deadLetterRetention: outside,
        },
      };

      const error = await rejectionOf(applyBrokerPlan(connecting, orders.plan, limits));

      expect(error.message.split('\n').map((line) => line.split(' ')[0])).toEqual([
        'limits.durableConsumerDefaults.retention',
        'limits.durableConsumerDefaults.deadLetterRetention',
      ]);
      expect(await topicNamesOf(connecting.sns)).toEqual([]);
    },
  );

  test('an account that is not 12 digits is refused, creating nothing', async () => {
    const orders = anOrders();
    const connecting = anAwsConnecting(moto.url, { account: '1234' });

    const error = await rejectionOf(applyBrokerPlan(connecting, orders.plan, testLimits));

    expect(error.message).toBe("connecting.account '1234' is not a 12-digit AWS account id");
    expect(await topicNamesOf(connecting.sns)).toEqual([]);
  });

  test('a Durable consumer whose Stream’s topic does not exist yet is refused naming the Stream and the topic ARN it looked for, and the topics created before it stay', async () => {
    const billing = aBilling();
    const own: BrokerPlan = {
      ...billing.plan,
      streams: {
        'billing-service': { service: 'billing-service', subjects: ['billing-service.event.E.v1'] },
      },
    };
    const connecting = anAwsConnecting(moto.url);

    const error = await rejectionOf(applyBrokerPlan(connecting, own, testLimits));

    expect(error.message).toBe(
      `The Durable consumer ${billing.durable} reads the stream orders-service, whose topic ${snsArnOf('orders-service')} does not exist yet: apply its Service's plan first`,
    );
    expect(await topicNamesOf(connecting.sns)).toEqual(['billing-service']);
  });

  test('with another account given, the topic ARN the refusal names shows that account', async () => {
    const billing = aBilling();
    const connecting = anAwsConnecting(moto.url, { account: '210987654321' });

    const error = await rejectionOf(applyBrokerPlan(connecting, billing.plan, testLimits));

    expect(error.message).toBe(
      `The Durable consumer ${billing.durable} reads the stream orders-service, whose topic arn:aws:sns:eu-west-1:210987654321:orders-service does not exist yet: apply its Service's plan first`,
    );
  });

  test('applyBrokerPlan stops at the first Durable consumer it cannot apply and creates none after it', async () => {
    const orders = anOrders();
    const subject = 'ghost.event.E.v1';
    const plan: BrokerPlan = {
      ...orders.plan,
      durableConsumers: {
        'a-first': { service: 'orders-service', stream: 'ghost', subject },
        ...orders.plan.durableConsumers,
      },
    };
    const connecting = anAwsConnecting(moto.url);

    const error = await rejectionOf(applyBrokerPlan(connecting, plan, testLimits));

    expect(error.message).toMatch(/^The Durable consumer a-first reads the stream ghost/);
    expect(await queueNamesOf(connecting.sqs)).toEqual([]);
    expect(await topicNamesOf(connecting.sns)).toEqual(['orders-service']);
  });

  test('a failure of the SNS client rejects naming the Stream, with the client’s error as cause', async () => {
    const orders = anOrders();
    const connecting = anAwsConnecting(await aClosedUrl());

    const error = await rejectionOf(applyBrokerPlan(connecting, orders.plan, testLimits));

    expect(error.message).toMatch(/^The stream orders-service could not be applied: /);
    expect(error.cause).toBeInstanceOf(Error);
  });

  test('a failure of the SQS client rejects naming the Durable consumer, with the client’s error as cause', async () => {
    const orders = anOrders();
    const connecting = anAwsConnecting(moto.url, { sqsUrl: await aClosedUrl() });

    const error = await rejectionOf(applyBrokerPlan(connecting, orders.plan, testLimits));

    expect(error.message).toMatch(
      new RegExp(`^The Durable consumer ${orders.chargeDurable} could not be applied: `),
    );
    expect(error.cause).toBeInstanceOf(Error);
  });

  test('the region of the clients decides the partition of every ARN', async () => {
    const orders = anOrders();
    const connecting = anAwsConnecting(moto.url, { region: 'us-gov-west-1' });

    await applyBrokerPlan(connecting, orders.plan, testLimits);

    const queue = await queueAttributesOf(connecting.sqs, orders.chargeDurable);
    const deadLetter = JSON.parse(queue['RedrivePolicy'] ?? '{}').deadLetterTargetArn;
    const policy = JSON.parse(queue['Policy'] ?? '{}').Statement[0];
    const [subscription] = await subscriptionsOf(
      connecting.sns,
      'arn:aws-us-gov:sns:us-gov-west-1:123456789012:orders-service',
    );
    expect(deadLetter).toBe(
      `arn:aws-us-gov:sqs:us-gov-west-1:123456789012:${orders.chargeDurable}_dlq`,
    );
    expect(policy.Condition.ArnEquals['aws:SourceArn']).toBe(
      'arn:aws-us-gov:sns:us-gov-west-1:123456789012:orders-service',
    );
    expect(subscription?.endpoint).toBe(
      `arn:aws-us-gov:sqs:us-gov-west-1:123456789012:${orders.chargeDurable}`,
    );
  });

  test('a Stream read by more than 100 Durable consumers, applied again, subscribes none again and keeps one subscription for each queue', async () => {
    const names = Array.from({ length: 130 }, (_, index) => `long_consumer-${index}`);
    const plan = aPlanOfDurables(names);
    const connecting = anAwsConnecting(moto.url);
    await applyBrokerPlan(connecting, plan, testLimits);
    const subscribes = countCommands(connecting.sns, 'SubscribeCommand');

    await applyBrokerPlan(connecting, plan, testLimits);

    const subscriptions = await subscriptionsOf(connecting.sns, snsArnOf('long'));
    const endpoints = subscriptions.map(({ endpoint }) => endpoint);
    expect(subscribes.sent()).toBe(0);
    expect(new Set(endpoints)).toEqual(new Set(names.map(sqsArnOf)));
    expect(endpoints).toHaveLength(130);
  }, 60_000);

  test('the Durable consumers of one topic share one listing of its subscriptions', async () => {
    const plan = aPlanOfDurables(['long_first', 'long_second']);
    const connecting = anAwsConnecting(moto.url);
    const listings = countCommands(connecting.sns, 'ListSubscriptionsByTopicCommand');

    await applyBrokerPlan(connecting, plan, testLimits);

    expect(listings.sent()).toBe(1);
  });

  test('an account that is not 12 digits and a setting left unset are refused in one error, a line each', async () => {
    const orders = anOrders();
    const connecting = anAwsConnecting(moto.url, { account: '1234' });
    const limits: SqsBrokerLimits = { durableConsumerDefaults: { ackWait: '30s' } };

    const error = await rejectionOf(applyBrokerPlan(connecting, orders.plan, limits));

    expect(error.message.split('\n')).toEqual([
      "connecting.account '1234' is not a 12-digit AWS account id",
      `The Durable consumer ${orders.chargeDurable} has no maxDeliver, retention, deadLetterRetention in limits.durableConsumers or limits.durableConsumerDefaults`,
    ]);
  });

  test('clients in two regions are refused naming both, creating nothing', async () => {
    const orders = anOrders();
    const connecting = anAwsConnecting(moto.url, { region: 'eu-west-1', sqsRegion: 'us-east-1' });

    const error = await rejectionOf(applyBrokerPlan(connecting, orders.plan, testLimits));

    expect(error.message).toBe(
      'connecting.sns is in the region eu-west-1 and connecting.sqs in us-east-1: they must be in one region',
    );
    expect(await topicNamesOf(connecting.sns)).toEqual([]);
    expect(await queueNamesOf(connecting.sqs)).toEqual([]);
  });

  test('clients of two regions and an account that is not 12 digits are refused in one error, a line each', async () => {
    const orders = anOrders();
    const connecting = anAwsConnecting(moto.url, {
      region: 'eu-west-1',
      sqsRegion: 'us-east-1',
      account: '1234',
    });

    const error = await rejectionOf(applyBrokerPlan(connecting, orders.plan, testLimits));

    expect(error.message.split('\n')).toEqual([
      "connecting.account '1234' is not a 12-digit AWS account id",
      'connecting.sns is in the region eu-west-1 and connecting.sqs in us-east-1: they must be in one region',
    ]);
  });

  test('an SQS client in another account than the account is refused on every run, naming both ARNs, before anything is set or subscribed', async () => {
    const orders = anOrders();
    const connecting = anAwsConnecting(moto.url);
    inAccount(connecting.sqs, '210987654321');
    const set = recordingInputs(connecting.sqs, 'SetQueueAttributesCommand');
    const subscribes = countCommands(connecting.sns, 'SubscribeCommand');
    const refused = `The Durable consumer ${orders.chargeDurable} could not be applied: SQS gave the queue ${orders.chargeDurable}_dlq the ARN arn:aws:sqs:eu-west-1:210987654321:${orders.chargeDurable}_dlq, not ${sqsArnOf(`${orders.chargeDurable}_dlq`)}: check connecting.account and the region of the clients`;

    const runs = [
      await rejectionOf(applyBrokerPlan(connecting, orders.plan, testLimits)),
      await rejectionOf(applyBrokerPlan(connecting, orders.plan, testLimits)),
      await rejectionOf(applyBrokerPlan(connecting, orders.plan, testLimits)),
    ];

    expect(runs.map((error) => error.message)).toEqual([refused, refused, refused]);
    expect(set.sent()).toEqual([]);
    expect(subscribes.sent()).toBe(0);
  });

  test('an account other than the topics’ own is refused as the ARN CreateTopic gave, not the one built', async () => {
    const orders = anOrders();
    const connecting = anAwsConnecting(moto.url, { account: '210987654321' });

    const error = await rejectionOf(applyBrokerPlan(connecting, orders.plan, testLimits));

    expect(error.message).toBe(
      `The stream ${orders.stream} could not be applied: CreateTopic gave ${snsArnOf(orders.stream)}, not arn:aws:sns:eu-west-1:210987654321:${orders.stream}`,
    );
    expect(await queueNamesOf(connecting.sqs)).toEqual([]);
  });

  test.each([
    {
      what: 'SQS answers a new queue without its URL',
      client: 'sqs',
      command: 'CreateQueueCommand',
      field: 'QueueUrl',
      alter: (output: Record<string, unknown>) => delete output['QueueUrl'],
    },
    {
      what: 'SQS answers a queue without its ARN',
      client: 'sqs',
      command: 'GetQueueAttributesCommand',
      field: 'QueueArn',
      alter: (output: Record<string, unknown>) => (output['Attributes'] = {}),
    },
    {
      what: 'SNS answers a new subscription without its ARN',
      client: 'sns',
      command: 'SubscribeCommand',
      field: 'SubscriptionArn',
      alter: (output: Record<string, unknown>) => delete output['SubscriptionArn'],
    },
  ] as const)(
    'when $what, applyBrokerPlan rejects naming the Durable consumer and the field',
    async ({ client, command, field, alter }) => {
      const orders = anOrders();
      const connecting = anAwsConnecting(moto.url);
      alteringAnswers(connecting[client], command, alter);

      const error = await rejectionOf(applyBrokerPlan(connecting, orders.plan, testLimits));

      expect(error.message).toBe(
        `The Durable consumer ${orders.chargeDurable} could not be applied: AWS answered no ${field}`,
      );
    },
  );

  test('when SNS lists a subscription without its endpoint, applyBrokerPlan rejects naming the Durable consumer and the field', async () => {
    const orders = anOrders();
    const connecting = anAwsConnecting(moto.url);
    await applyBrokerPlan(connecting, orders.plan, testLimits);
    alteringAnswers(connecting.sns, 'ListSubscriptionsByTopicCommand', (output) => {
      output['Subscriptions'] = [{ SubscriptionArn: 'arn', Protocol: 'sqs' }];
    });

    const error = await rejectionOf(applyBrokerPlan(connecting, orders.plan, testLimits));

    expect(error.message).toBe(
      `The Durable consumer ${orders.chargeDurable} could not be applied: AWS answered no Endpoint`,
    );
  });

  test('a new queue is created with its attributes, redrive policy, policy and tags, and its dead-letter queue with its attributes and tags, none set afterwards', async () => {
    const orders = anOrders();
    const connecting = anAwsConnecting(moto.url);
    const created = recordingInputs(connecting.sqs, 'CreateQueueCommand');
    const set = recordingInputs(connecting.sqs, 'SetQueueAttributesCommand');

    await applyBrokerPlan(connecting, orders.plan, testLimits);

    const [deadLetter, queue] = created.sent();
    expect(deadLetter).toMatchObject({
      QueueName: `${orders.chargeDurable}_dlq`,
      Attributes: { MessageRetentionPeriod: '1209600' },
      tags: { 'cf-loom:durable': orders.chargeDurable, 'cf-loom:service': 'orders-service' },
    });
    expect(queue).toMatchObject({
      QueueName: orders.chargeDurable,
      Attributes: {
        VisibilityTimeout: '30',
        MessageRetentionPeriod: '345600',
        RedrivePolicy: JSON.stringify({
          deadLetterTargetArn: sqsArnOf(`${orders.chargeDurable}_dlq`),
          maxReceiveCount: 5,
        }),
      },
      tags: { 'cf-loom:durable': orders.chargeDurable, 'cf-loom:service': 'orders-service' },
    });
    expect(queue).toMatchObject({
      Attributes: {
        Policy: expect.stringContaining(`"Resource":"${sqsArnOf(orders.chargeDurable)}"`),
      },
    });
    expect(set.sent()).toEqual([]);
  });

  test('a new queue whose ARN SQS gives otherwise than the account and region of the clients make is refused naming both, before its Durable consumer is subscribed', async () => {
    const orders = anOrders();
    const connecting = anAwsConnecting(moto.url);
    alteringAnswers(connecting.sqs, 'GetQueueAttributesCommand', (output) => {
      output['Attributes'] = { QueueArn: 'arn:aws:sqs:eu-west-1:210987654321:elsewhere' };
    });

    const error = await rejectionOf(applyBrokerPlan(connecting, orders.plan, testLimits));

    expect(error.message).toBe(
      `The Durable consumer ${orders.chargeDurable} could not be applied: SQS gave the queue ${orders.chargeDurable}_dlq the ARN arn:aws:sqs:eu-west-1:210987654321:elsewhere, not ${sqsArnOf(`${orders.chargeDurable}_dlq`)}: check connecting.account and the region of the clients`,
    );
    expect(await subscriptionsOf(connecting.sns, snsArnOf(orders.stream))).toEqual([]);
  });
});
