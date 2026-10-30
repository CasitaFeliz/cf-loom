import { SNSClient } from '@aws-sdk/client-sns';
import { SQSClient } from '@aws-sdk/client-sqs';
import { describe, expect, expectTypeOf, test } from 'vitest';
import type { Broker } from '../index.ts';
import {
  applyBrokerPlan,
  type BrokerPlan,
  type SqsBrokerLimits,
  type SqsBrokerOptions,
  type SqsConnecting,
  type SqsDurableConsumerLimits,
  sqs,
} from './index.ts';

const plan = {} as BrokerPlan;
const limits = {} as SqsBrokerLimits;
const connecting = { sns: new SNSClient({}), sqs: new SQSClient({}), account: '123456789012' };

describe('applyBrokerPlan types', () => {
  test('applyBrokerPlan refuses a connecting variable holding the clients and a misspelled account', () => {
    const given = { ...connecting, acount: '123456789012' };

    // @ts-expect-error TS2345 acount is not a declared field
    const applying = () => applyBrokerPlan(given, plan, limits);

    expect(applying).toBeTypeOf('function');
  });

  test('applyBrokerPlan refuses limits given through a variable with stream defaults, which a topic has none of', () => {
    const given = { streamDefaults: { maxAge: '7d' } } as const;

    // @ts-expect-error TS2345 streamDefaults is not a declared field
    const applying = () => applyBrokerPlan(connecting, plan, given);

    expect(applying).toBeTypeOf('function');
  });

  test('applyBrokerPlan refuses Durable consumer defaults given through a variable with a setting SNS/SQS does not have', () => {
    const given = { durableConsumerDefaults: { maxDeliver: 5, maxAckPending: 5 } } as const;

    // @ts-expect-error TS2345 maxAckPending is not a declared field
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

describe('sqs() types', () => {
  test('SqsBrokerOptions holds the SNS client, the SQS client, the account and the Broker prefix, and no more', () => {
    expectTypeOf<keyof SqsBrokerOptions>().toEqualTypeOf<'sns' | 'sqs' | 'account' | 'prefix'>();
  });

  test('sqs() returns a Broker', () => {
    const broker = sqs(connecting);

    expectTypeOf(broker).toEqualTypeOf<Broker>();
    expect(broker.connect).toBeTypeOf('function');
  });

  test('sqs() accepts a literal without the prefix, and with a prefix that is a literal, undefined or a widened string', () => {
    let widened = 'staging';
    widened = widened.trim();
    const { sns, account } = connecting;
    const sqsClient = connecting.sqs;

    const brokers = [
      sqs({ sns, sqs: sqsClient, account }),
      sqs({ sns, sqs: sqsClient, account, prefix: 'staging' }),
      sqs({ sns, sqs: sqsClient, account, prefix: undefined }),
      sqs({ sns, sqs: sqsClient, account, prefix: widened }),
    ];

    expect(brokers).toHaveLength(4);
  });

  test('sqs() accepts a variable upcast to the shape, a union of two declared shapes and a function forwarding the concrete type', () => {
    const upcast: SqsBrokerOptions = { ...connecting };
    const union = Math.random() > 2 ? { ...connecting } : { ...connecting, prefix: 'staging' };
    const forwarding = (options: SqsBrokerOptions) => sqs(options);

    const brokers = [sqs(upcast), sqs(union), forwarding(upcast)];

    expect(brokers).toHaveLength(3);
  });

  test('sqs() accepts an explicit SqsBrokerOptions, never and any', () => {
    const explicit = sqs<SqsBrokerOptions>({ ...connecting, prefix: 'staging' });
    const never = () => sqs(undefined as never);
    const anything = () => sqs(JSON.parse('{}'));

    expect(explicit.connect).toBeTypeOf('function');
    expect(never).toBeTypeOf('function');
    expect(anything).toBeTypeOf('function');
  });

  test('sqs() refuses an undeclared field in the literal, a misspelled prefix or a region', () => {
    // @ts-expect-error TS2322 prefx is not a declared field
    const misspelled = () => sqs({ ...connecting, prefx: 'staging' });
    // @ts-expect-error TS2322 region is not a declared field: the clients hold the region
    const withRegion = () => sqs({ ...connecting, region: 'eu-west-1' });

    expect(misspelled).toBeTypeOf('function');
    expect(withRegion).toBeTypeOf('function');
  });

  test('sqs() refuses an undeclared field given through a variable of one object type', () => {
    const options = { ...connecting, prefx: 'staging' };

    // @ts-expect-error TS2345 prefx is not a declared field
    const misspelled = () => sqs(options);

    expect(misspelled).toBeTypeOf('function');
  });

  test('sqs() refuses an undeclared field with an explicit SqsBrokerOptions', () => {
    // @ts-expect-error TS2561 prefx is not a declared field, said as a misspelling of prefix
    const misspelled = () => sqs<SqsBrokerOptions>({ ...connecting, prefx: 'staging' });

    expect(misspelled).toBeTypeOf('function');
  });

  test('sqs() refuses a null prefix and a numeric account', () => {
    // @ts-expect-error TS2322 prefix is a string or undefined, never null
    const nullPrefix = () => sqs({ ...connecting, prefix: null });
    // @ts-expect-error TS2322 account is the 12-digit id as a string
    const numericAccount = () => sqs({ ...connecting, account: 123456789012 });

    expect(nullPrefix).toBeTypeOf('function');
    expect(numericAccount).toBeTypeOf('function');
  });

  test('sqs() refuses options without an account or without the SNS client, and an unknown value', () => {
    const { sns, account } = connecting;
    const sqsClient = connecting.sqs;

    // @ts-expect-error TS2345 the account is missing
    const withoutAccount = () => sqs({ sns, sqs: sqsClient });
    // @ts-expect-error TS2345 the SNS client is missing
    const withoutSns = () => sqs({ sqs: sqsClient, account });
    // @ts-expect-error TS2345 unknown is not the options
    const unknownOptions = () => sqs(JSON.parse('{}') as unknown);

    expect(withoutAccount).toBeTypeOf('function');
    expect(withoutSns).toBeTypeOf('function');
    expect(unknownOptions).toBeTypeOf('function');
  });

  test('sqs() refuses a union one of whose members holds an undeclared field, and a type parameter constrained to the shape', () => {
    const union = Math.random() > 2 ? { ...connecting } : { ...connecting, prefx: 'staging' };
    const forwarding = <Options extends SqsBrokerOptions>(options: Options) => {
      // @ts-expect-error TS2345 a type parameter constrained to the shape may hold more
      return sqs(options);
    };

    // @ts-expect-error TS2345 a member of the union holds a field the shape does not declare
    const unionOptions = () => sqs(union);

    expect(unionOptions).toBeTypeOf('function');
    expect(forwarding).toBeTypeOf('function');
  });
});
