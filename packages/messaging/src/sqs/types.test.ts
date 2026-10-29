import { SNSClient } from '@aws-sdk/client-sns';
import { SQSClient } from '@aws-sdk/client-sqs';
import { describe, expect, expectTypeOf, test } from 'vitest';
import {
  applyBrokerPlan,
  type BrokerPlan,
  type SqsBrokerLimits,
  type SqsConnecting,
  type SqsDurableConsumerLimits,
} from './index.ts';

const plan = {} as BrokerPlan;
const limits = {} as SqsBrokerLimits;
const connecting = { sns: new SNSClient({}), sqs: new SQSClient({}), account: '123456789012' };

describe('applyBrokerPlan types', () => {
  test('applyBrokerPlan refuses a connecting variable holding the clients and a misspelled account', () => {
    const given = { ...connecting, acount: '123456789012' };

    // @ts-expect-error acount is not a declared field
    const applying = () => applyBrokerPlan(given, plan, limits);

    expect(applying).toBeTypeOf('function');
  });

  test('applyBrokerPlan refuses limits given through a variable with stream defaults, which a topic has none of', () => {
    const given = { streamDefaults: { maxAge: '7d' } } as const;

    // @ts-expect-error streamDefaults is not a declared field
    const applying = () => applyBrokerPlan(connecting, plan, given);

    expect(applying).toBeTypeOf('function');
  });

  test('applyBrokerPlan refuses Durable consumer defaults given through a variable with a setting SNS/SQS does not have', () => {
    const given = { durableConsumerDefaults: { maxDeliver: 5, maxAckPending: 5 } } as const;

    // @ts-expect-error maxAckPending is not a declared field
    const applying = () => applyBrokerPlan(connecting, plan, given);

    expect(applying).toBeTypeOf('function');
  });

  test('applyBrokerPlan accepts a connecting variable and limits holding only declared fields', () => {
    const given = {
      durableConsumerDefaults: { ackWait: ['30s', '1m'], maxDeliver: 5 },
      durableConsumers: { 'orders-service_command_ChargeCard_v1': { retention: '7d' } },
    } as const;

    const applying = () => applyBrokerPlan(connecting, plan, given);

    expect(applying).toBeTypeOf('function');
  });
});

describe('the records an SNS/SQS applier takes', () => {
  test('SqsConnecting holds the SNS client, the SQS client and the account, and no more', () => {
    expectTypeOf<keyof SqsConnecting>().toEqualTypeOf<'sns' | 'sqs' | 'account'>();
  });

  test('SqsBrokerLimits hold the Durable consumer defaults and overrides, and no more', () => {
    expectTypeOf<keyof SqsBrokerLimits>().toEqualTypeOf<
      'durableConsumerDefaults' | 'durableConsumers'
    >();
  });

  test('SqsDurableConsumerLimits hold the ack wait, delivery cap and the retentions, and no more', () => {
    expectTypeOf<keyof SqsDurableConsumerLimits>().toEqualTypeOf<
      'ackWait' | 'maxDeliver' | 'retention' | 'deadLetterRetention'
    >();
  });
});
