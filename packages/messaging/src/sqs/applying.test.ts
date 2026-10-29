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
});
