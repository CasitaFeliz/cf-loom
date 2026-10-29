// biome-ignore-all lint/style/useNamingConvention: AWS names its fields in PascalCase, as they travel
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import {
  anAwsConnecting,
  queueAttributesOf,
  queueNamesOf,
  queueTagsOf,
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

function sqsArnOf(queue: string): string {
  return `arn:aws:sqs:eu-west-1:123456789012:${queue}`;
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
});
