import type { NatsConnection } from '@nats-io/nats-core';
import { describe, expect, expectTypeOf, test } from 'vitest';
import type { Broker } from '../index.ts';
import {
  applyBrokerPlan,
  type BrokerLimits,
  type BrokerPlan,
  type BrokerPlanDurableConsumer,
  type BrokerPlanStream,
  type DurableConsumerLimits,
  type JetStreamBrokerOptions,
  type JetStreamConnecting,
  jetstream,
  type StreamLimits,
} from './index.ts';

const connect = (): Promise<NatsConnection> => Promise.reject(new Error('no NATS in this test'));

const plan = {} as BrokerPlan;
const limits = {} as BrokerLimits;

describe('jetstream() types', () => {
  test('jetstream() returns a Broker, with no apply', () => {
    const broker = jetstream({ connect, prefix: 'staging' });

    // @ts-expect-error: applying a broker plan is applyBrokerPlan, no part of a Broker
    const apply = broker.apply;

    expectTypeOf(broker).toEqualTypeOf<Broker>();
    expect(apply).toBeUndefined();
  });

  test('jetstream() refuses an options variable holding connect and a misspelled prefix', () => {
    const options = { connect, prefx: 'staging' };

    // @ts-expect-error prefx is not a declared field
    const brokerOf = () => jetstream(options);

    expect(brokerOf).toBeTypeOf('function');
  });

  test('jetstream() accepts an options variable holding only declared fields', () => {
    const options = { connect, prefix: 'staging', jetstream: { timeout: 1_000 } };

    const broker = jetstream(options);

    expectTypeOf(broker).toEqualTypeOf<Broker>();
    expect(broker.connect).toBeTypeOf('function');
  });

  test('applyBrokerPlan refuses a connecting variable holding connect and a misspelled jetstream', () => {
    const connecting = { connect, jetstrem: { domain: 'hub' } };

    // @ts-expect-error jetstrem is not a declared field
    const applying = () => applyBrokerPlan(connecting, plan, limits);

    expect(applying).toBeTypeOf('function');
  });

  test('applyBrokerPlan refuses a connecting variable holding a prefix, which the plan names', () => {
    const connecting = { connect, prefix: 'staging' };

    // @ts-expect-error prefix is not a declared field: the plan names the Broker prefix
    const applying = () => applyBrokerPlan(connecting, plan, limits);

    expect(applying).toBeTypeOf('function');
  });

  test('applyBrokerPlan refuses limits given through a variable with a field they do not declare', () => {
    const given = {
      streamDefaults: { maxAge: '7d' },
      durableConsumerDefault: { maxDeliver: 5 },
    } as const;

    // @ts-expect-error durableConsumerDefault is not a declared field
    const applying = () => applyBrokerPlan({ connect }, plan, given);

    expect(applying).toBeTypeOf('function');
  });

  test('applyBrokerPlan refuses stream defaults given through a variable with a field they do not declare', () => {
    const given = { streamDefaults: { replicas: 1, replica: 3 } } as const;

    // @ts-expect-error replica is not a declared field
    const applying = () => applyBrokerPlan({ connect }, plan, given);

    expect(applying).toBeTypeOf('function');
  });

  test('applyBrokerPlan refuses Durable consumer defaults given through a variable with a field they do not declare', () => {
    const given = { durableConsumerDefaults: { maxDeliver: 5, maxDelivery: 5 } } as const;

    // @ts-expect-error maxDelivery is not a declared field
    const applying = () => applyBrokerPlan({ connect }, plan, given);

    expect(applying).toBeTypeOf('function');
  });

  test('applyBrokerPlan accepts limits given through a variable holding only declared fields', () => {
    const given = {
      streamDefaults: { maxAge: '7d', replicas: 3 },
      durableConsumerDefaults: { maxDeliver: 5 },
      streams: { 'orders-service': { replicas: 1 } },
    } as const;

    const applying = () => applyBrokerPlan({ connect }, plan, given);

    expect(applying).toBeTypeOf('function');
  });

  test('applyBrokerPlan accepts a connecting variable holding only declared fields', () => {
    const connecting = { connect, jetstream: { domain: 'hub' } };

    const applying = () => applyBrokerPlan(connecting, plan, limits);

    expect(applying).toBeTypeOf('function');
  });
});

describe('the records a JetStream broker takes and plans', () => {
  test('JetStreamConnecting holds how to connect and the JetStream options, and no more', () => {
    expectTypeOf<keyof JetStreamConnecting>().toEqualTypeOf<'connect' | 'jetstream'>();
  });

  test('JetStreamBrokerOptions hold JetStreamConnecting’s keys and the Broker prefix, and no more', () => {
    expectTypeOf<keyof JetStreamBrokerOptions>().toEqualTypeOf<
      'connect' | 'jetstream' | 'prefix'
    >();
  });

  test('a BrokerPlan holds the Broker prefix, the Streams and the Durable consumers, and no more', () => {
    expectTypeOf<keyof BrokerPlan>().toEqualTypeOf<'prefix' | 'streams' | 'durableConsumers'>();
  });

  test('a BrokerPlanStream holds its Service and subjects, and no more', () => {
    expectTypeOf<keyof BrokerPlanStream>().toEqualTypeOf<'service' | 'subjects'>();
  });

  test('a BrokerPlanDurableConsumer holds its Service, Stream and subject, and no more', () => {
    expectTypeOf<keyof BrokerPlanDurableConsumer>().toEqualTypeOf<
      'service' | 'stream' | 'subject'
    >();
  });

  test('BrokerLimits hold the Stream and Durable consumer defaults and overrides, and no more', () => {
    expectTypeOf<keyof BrokerLimits>().toEqualTypeOf<
      'streamDefaults' | 'streams' | 'durableConsumerDefaults' | 'durableConsumers'
    >();
  });

  test('StreamLimits hold the retention, storage, replicas, age and duplicate window, and no more', () => {
    expectTypeOf<keyof StreamLimits>().toEqualTypeOf<
      'retention' | 'storage' | 'replicas' | 'maxAge' | 'duplicateWindow'
    >();
  });

  test('DurableConsumerLimits hold the ack wait, delivery policy, redelivery and pending limits, and no more', () => {
    expectTypeOf<keyof DurableConsumerLimits>().toEqualTypeOf<
      'ackWait' | 'deliverPolicy' | 'maxDeliver' | 'maxAckPending'
    >();
  });
});
