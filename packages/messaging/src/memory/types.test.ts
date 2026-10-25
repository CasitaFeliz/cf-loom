import {
  type Command,
  defineCommand,
  defineContract,
  defineEvent,
  defineGroup,
  defineSubscription,
  type Event,
  type Subscription,
} from '@cf-loom/contract';
import { describe, expect, expectTypeOf, test } from 'vitest';
import { z } from 'zod';
import { type Broker, messaging } from '../index.ts';
import { type DeliveryMeta, memory, type PendingMessage, type RecordedMessage } from './index.ts';

const orderCreatedV1 = defineEvent({
  name: 'OrderCreated',
  version: 1,
  visibility: 'internal',
  description: 'An order was created',
  body: z.object({ orderId: z.string() }),
});

const chargeCardV1 = defineCommand({
  name: 'ChargeCard',
  version: 1,
  description: 'Charges the order’s card',
  body: z.object({ orderId: z.string() }),
});

const notifyOnCreated = defineSubscription({
  name: 'notifyOnCreated',
  description: 'Notify on created',
  event: orderCreatedV1,
});

const contract = defineContract({
  name: 'orders-service',
  groups: [
    defineGroup({
      name: 'messages',
      description: 'Messages',
      events: [orderCreatedV1],
      commands: [chargeCardV1],
      subscriptions: [notifyOnCreated],
    }),
  ],
});

const broker = memory();

describe('memory types', () => {
  test('memory() is a Broker messaging() takes', () => {
    const connecting = () => messaging(contract, broker);

    expectTypeOf(broker).toExtend<Broker>();
    expectTypeOf(connecting).returns.resolves.toHaveProperty('publisher');
    expect(connecting).toBeTypeOf('function');
  });

  test('deliver takes an Event or a Command and resolves to acked, pending or ended', () => {
    const deliveringSubscription = () =>
      // @ts-expect-error: a Subscription is no Message Version to deliver, redeliver() retries
      broker.deliver(notifyOnCreated, {});

    expectTypeOf(broker.deliver).parameter(0).toEqualTypeOf<Event | Command>();
    expectTypeOf(broker.deliver).parameter(2).toEqualTypeOf<DeliveryMeta | undefined>();
    expectTypeOf(broker.deliver).returns.resolves.toEqualTypeOf<'acked' | 'pending' | 'ended'>();
    expect(deliveringSubscription).toBeTypeOf('function');
  });

  test('redeliver and settled resolve to nothing', () => {
    expectTypeOf(broker.redeliver).returns.resolves.toEqualTypeOf<void>();
    expectTypeOf(broker.settled).returns.resolves.toEqualTypeOf<void>();
    expect(broker.redeliver).toBeTypeOf('function');
  });

  test('messages and pending list read-only records', () => {
    expectTypeOf(broker.messages).toEqualTypeOf<readonly RecordedMessage[]>();
    expectTypeOf(broker.pending).toEqualTypeOf<readonly PendingMessage[]>();
    expectTypeOf<PendingMessage['element']>().toEqualTypeOf<Subscription | Command>();
    expectTypeOf<RecordedMessage['body']>().toEqualTypeOf<unknown>();
    expectTypeOf<PendingMessage['body']>().toEqualTypeOf<unknown>();
    expect(broker.messages).toEqual([]);
  });

  test('memory() has no apply', () => {
    // @ts-expect-error: no broker plan exists to apply
    const apply = broker.apply;

    expect(apply).toBeUndefined();
  });
});
