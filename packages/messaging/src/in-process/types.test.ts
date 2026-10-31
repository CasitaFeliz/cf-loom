import { describe, expect, expectTypeOf, test } from 'vitest';
import type { Broker } from '../index.ts';
import type { JetStreamBrokerLimits } from '../jetstream/index.ts';
import type { SqsBrokerLimits, SqsDurableConsumerLimits } from '../sqs/index.ts';
import {
  type InProcessBrokerLimits,
  type InProcessDurableConsumerLimits,
  inProcess,
} from './index.ts';

describe('the records inProcess() takes', () => {
  test('InProcessBrokerLimits hold the Durable consumer defaults and overrides, and no more', () => {
    expectTypeOf<keyof InProcessBrokerLimits>().toEqualTypeOf<
      'durableConsumerDefaults' | 'durableConsumers'
    >();
  });

  test('InProcessDurableConsumerLimits hold the ack wait and the delivery cap, and no more', () => {
    expectTypeOf<keyof InProcessDurableConsumerLimits>().toEqualTypeOf<'ackWait' | 'maxDeliver'>();
  });
});

describe('inProcess() types', () => {
  test('inProcess() returns a Broker', () => {
    const broker = inProcess({ durableConsumerDefaults: { ackWait: '30s', maxDeliver: 5 } });

    expectTypeOf(broker).toEqualTypeOf<Broker>();
    expect(broker.connect).toBeTypeOf('function');
  });

  test('inProcess() accepts defaults, a list of waits with unlimited deliveries, an override under a name, only names and nothing at all', () => {
    const named = 'orders-service_command_ChargeCard_v1';

    const brokers = [
      inProcess({ durableConsumerDefaults: { ackWait: '30s', maxDeliver: 5 } }),
      inProcess({ durableConsumerDefaults: { ackWait: ['1s', '5s'], maxDeliver: 'unlimited' } }),
      inProcess({
        durableConsumerDefaults: { ackWait: '30s', maxDeliver: 5 },
        durableConsumers: { [named]: { ackWait: '1m' } },
      }),
      inProcess({ durableConsumers: { [named]: { ackWait: '1m', maxDeliver: 2 } } }),
      inProcess({}),
    ];

    expect(brokers).toHaveLength(5);
  });

  test('inProcess() accepts a variable upcast to the shape, an explicit unknown, a count typed number, never and any', () => {
    const upcast: InProcessBrokerLimits = { durableConsumerDefaults: { ackWait: '1s' } };
    const count: number = Math.max(1, 3);

    const brokers = [
      inProcess(upcast),
      inProcess<unknown>({ durableConsumerDefaults: { ackWait: '1s', maxDeliver: 2 } }),
      inProcess({ durableConsumerDefaults: { ackWait: '1s', maxDeliver: count } }),
      inProcess(undefined as never),
      inProcess(JSON.parse('{}')),
    ];

    expect(brokers).toHaveLength(5);
  });

  test('inProcess() refuses unknown, which could hold anything', () => {
    const anything: unknown = {};

    // @ts-expect-error TS2345 unknown is not the limits' shape
    const refused = () => inProcess(anything);

    expect(refused).toBeTypeOf('function');
  });

  test('inProcess() refuses a wait that is no duration, written out or widened to a string', () => {
    let widened = '30s';
    widened = widened.trim();

    // @ts-expect-error TS2322 '30 seconds' is no Duration
    const written = () => inProcess({ durableConsumerDefaults: { ackWait: '30 seconds' } });
    // @ts-expect-error TS2322 a string is no Duration
    const widenedWait = () => inProcess({ durableConsumerDefaults: { ackWait: widened } });

    expect(written).toBeTypeOf('function');
    expect(widenedWait).toBeTypeOf('function');
  });

  test('inProcess() refuses an undeclared field, a prefix for one, in the literal and through a variable', () => {
    const given = { durableConsumerDefaults: { ackWait: '1s' }, prefix: 'staging' } as const;

    // @ts-expect-error TS2322 prefix is not a declared field: nothing outside the process shares this Broker
    const inLiteral = () => inProcess({ durableConsumerDefaults: { ackWait: '1s' }, prefix: 'x' });
    // @ts-expect-error TS2345 prefix is not a declared field
    const throughVariable = () => inProcess(given);

    expect(inLiteral).toBeTypeOf('function');
    expect(throughVariable).toBeTypeOf('function');
  });

  test('inProcess() refuses a setting the Broker does not have, among the defaults', () => {
    const given = { durableConsumerDefaults: { ackWait: '1s', retention: '7d' } } as const;

    // @ts-expect-error TS2345 retention is not a declared field
    const refused = () => inProcess(given);

    expect(refused).toBeTypeOf('function');
  });

  test('inProcess() refuses stream defaults, which a Broker inside the process does not have', () => {
    const given = { streamDefaults: { maxAge: '7d' } } as const;

    // @ts-expect-error TS2345 streamDefaults is not a declared field
    const refused = () => inProcess(given);

    expect(refused).toBeTypeOf('function');
  });

  test('inProcess() refuses the limits of another adapter, whole or as the defaults', () => {
    const sqsLimits = {} as SqsBrokerLimits;
    const jetStreamLimits = {} as JetStreamBrokerLimits;
    const sqsDefaults = {} as SqsDurableConsumerLimits;

    // @ts-expect-error TS2345 SqsBrokerLimits has settings the Broker does not have
    const fromSqs = () => inProcess(sqsLimits);
    // @ts-expect-error TS2345 JetStreamBrokerLimits has streamDefaults
    const fromJetStream = () => inProcess(jetStreamLimits);
    // @ts-expect-error TS2322 SqsDurableConsumerLimits has settings the Broker does not have
    const asDefaults = () => inProcess({ durableConsumerDefaults: sqsDefaults });

    expect(fromSqs).toBeTypeOf('function');
    expect(fromJetStream).toBeTypeOf('function');
    expect(asDefaults).toBeTypeOf('function');
  });

  test('inProcess() refuses a union of the limits and limits with a prefix', () => {
    const declared = { durableConsumerDefaults: { ackWait: '1s' } } as const;
    const union = Math.random() > 2 ? declared : ({ ...declared, prefix: 'x' } as const);

    // @ts-expect-error TS2345 one member of the union has a prefix
    const refused = () => inProcess(union);

    expect(refused).toBeTypeOf('function');
  });

  test('inProcess() refuses a generic wrapper that forwards the limits', () => {
    // @ts-expect-error TS2345 a type parameter bounded by the limits may hold more fields
    const wrapper = <Limits extends InProcessBrokerLimits>(limits: Limits) => inProcess(limits);

    expect(wrapper).toBeTypeOf('function');
  });
});
