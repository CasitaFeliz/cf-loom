// biome-ignore-all lint/style/useNamingConvention: AWS names its fields in PascalCase, as they travel
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import {
  anAwsConnecting,
  arrangeTopic,
  publishOn,
  queueAttributesOf,
  queueNamesOf,
  queueTagsOf,
  receivedFrom,
  subscriptionAttributesOf,
  subscriptionsOf,
  topicNamesOf,
} from '../../test/aws-clients.ts';
import { aServiceOfLongestNames, planOf } from '../../test/broker-plans.ts';
import { aMotoServer, type MotoServer } from '../../test/moto-server.ts';
import { applyBrokerPlan, type BrokerPlan, type SqsBrokerLimits } from './index.ts';

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

  test('a list of ack waits gives the queue the first as its visibility timeout and the rest, as written, in its cf-loom:backoff tag; one wait gives it no backoff tag', async () => {
    const orders = anOrders();
    const connecting = anAwsConnecting(moto.url);
    const backoff: SqsBrokerLimits = {
      durableConsumerDefaults: {
        ...testLimits.durableConsumerDefaults,
        ackWait: ['30s', '1m', '5m'],
      },
    };

    await applyBrokerPlan(connecting, orders.plan, backoff);
    const withBackoff = await queueTagsOf(connecting.sqs, orders.chargeDurable);
    const attributes = await queueAttributesOf(connecting.sqs, orders.chargeDurable);
    await moto.reset();
    await applyBrokerPlan(connecting, orders.plan, testLimits);
    const withoutBackoff = await queueTagsOf(connecting.sqs, orders.chargeDurable);

    expect(attributes['VisibilityTimeout']).toBe('30');
    expect(withBackoff['cf-loom:backoff']).toBe('1m 5m');
    expect(Object.keys(withoutBackoff)).not.toContain('cf-loom:backoff');
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
});
