import {
  type Command,
  defineCommand,
  defineEvent,
  defineGroup,
  defineService,
  defineSubscription,
  type Event,
  openEnum,
  openEnumReader,
  providedEvent,
  type Subscription,
} from '@cf-loom/contract';
import { describe, expect, expectTypeOf, test } from 'vitest';
import { z } from 'zod';
import { type Broker, messaging } from '../index.ts';
import { type DeliveryMeta, memory, type PendingMessage, type RecordedMessage } from './index.ts';

const statuses = ['pending', 'paid'] as const;

const orderCreatedV1 = defineEvent({
  name: 'OrderCreated',
  version: 1,
  visibility: 'internal',
  description: 'An order was created',
  body: z.object({ orderId: z.string() }),
});

const orderPlacedV1 = defineEvent({
  name: 'OrderPlaced',
  version: 1,
  visibility: 'internal',
  description: 'An order was placed',
  body: z.object({ orderId: z.string(), status: openEnum(statuses) }),
});

const paymentSettledV1 = providedEvent('payments-service', {
  name: 'PaymentSettled',
  version: 1,
  visibility: 'internal',
  description: 'A payment was settled',
  body: z.object({ paymentId: z.string(), status: openEnumReader(statuses) }),
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

const contract = defineService({
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
    expectTypeOf(broker.deliver).returns.resolves.toEqualTypeOf<
      'acked' | 'pending' | 'ended' | 'handed-back'
    >();
    expect(deliveringSubscription).toBeTypeOf('function');
  });

  test('deliver takes the body its Message Version’s writer writes: a misspelled field is a type error', () => {
    const delivering = () =>
      // @ts-expect-error: ordrId is no field of OrderCreated's body
      broker.deliver(orderCreatedV1, { ordrId: 'o-1' });

    expectTypeOf(broker.deliver<typeof orderCreatedV1>)
      .parameter(1)
      .toEqualTypeOf<{ orderId: string }>();
    expect(delivering).toBeTypeOf('function');
  });

  test('deliver of a Command takes its Message Version’s body type', () => {
    const delivering = () =>
      // @ts-expect-error: amount is no field of ChargeCard's body
      broker.deliver(chargeCardV1, { orderId: 'o-1', amount: 12 });

    expectTypeOf(broker.deliver<typeof chargeCardV1>)
      .parameter(1)
      .toEqualTypeOf<{ orderId: string }>();
    expect(delivering).toBeTypeOf('function');
  });

  test('deliver of a Provided Event takes its Reader’s body, an Unknown case of an Open Enum included', () => {
    const delivering = () =>
      broker.deliver(paymentSettledV1, { paymentId: 'p-1', status: { unknown: 'refunded' } });

    expectTypeOf(broker.deliver<typeof paymentSettledV1>)
      .parameter(1)
      .toEqualTypeOf<{
        paymentId: string;
        status: 'pending' | 'paid' | { unknown: string };
      }>();
    expect(delivering).toBeTypeOf('function');
  });

  test('deliver of an own Event refuses an Unknown case of an Open Enum at compile time', () => {
    const delivering = () =>
      // @ts-expect-error: an own Event's writer writes a declared case, never an Unknown one
      broker.deliver(orderPlacedV1, { orderId: 'o-1', status: { unknown: 'refunded' } });

    expectTypeOf(broker.deliver<typeof orderPlacedV1>)
      .parameter(1)
      .toEqualTypeOf<{ orderId: string; status: 'pending' | 'paid' }>();
    expect(delivering).toBeTypeOf('function');
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

  test('messagesOf lists the Messages of a Message Version, their body typed by it', () => {
    const recorded = broker.messagesOf(orderCreatedV1);
    const sent = broker.messagesOf(chargeCardV1);

    expectTypeOf(recorded).toEqualTypeOf<readonly RecordedMessage<typeof orderCreatedV1>[]>();
    expectTypeOf(recorded).items.toHaveProperty('body').toEqualTypeOf<{ orderId: string }>();
    expectTypeOf(sent).items.toHaveProperty('body').toEqualTypeOf<{ orderId: string }>();
    expectTypeOf(recorded).items.toExtend<RecordedMessage>();
    expect(recorded).toEqual([]);
  });

  test('memory() has no apply', () => {
    // @ts-expect-error: no broker plan exists to apply
    const apply = broker.apply;

    expect(apply).toBeUndefined();
  });
});
