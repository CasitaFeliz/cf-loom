import type { NatsConnection } from '@nats-io/nats-core';
import { describe, expect, expectTypeOf, test } from 'vitest';
import type { Broker } from '../index.ts';
import { applyBrokerPlan, type BrokerLimits, type BrokerPlan, jetstream } from './index.ts';

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

  test('applyBrokerPlan accepts a connecting variable holding only declared fields', () => {
    const connecting = { connect, jetstream: { domain: 'hub' } };

    const applying = () => applyBrokerPlan(connecting, plan, limits);

    expect(applying).toBeTypeOf('function');
  });
});
