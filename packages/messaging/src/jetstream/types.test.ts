import type { NatsConnection } from '@nats-io/nats-core';
import { describe, expect, expectTypeOf, test } from 'vitest';
import type { Broker } from '../index.ts';
import { jetstream } from './index.ts';

const connect = (): Promise<NatsConnection> => Promise.reject(new Error('no NATS in this test'));

describe('jetstream() types', () => {
  test('jetstream() returns a Broker, with no apply', () => {
    const broker = jetstream({ connect, prefix: 'staging' });

    // @ts-expect-error: applying a broker plan is applyBrokerPlan, no part of a Broker
    const apply = broker.apply;

    expectTypeOf(broker).toEqualTypeOf<Broker>();
    expect(apply).toBeUndefined();
  });
});
