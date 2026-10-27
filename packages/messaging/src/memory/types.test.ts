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
import { type Messaging, messaging } from '../index.ts';
import {
  type DeliveryMeta,
  type MemoryMessaging,
  memory,
  type PendingMessage,
  type RecordedMessage,
} from './index.ts';

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

const inMemory = await memory(contract);

describe('memory types', () => {
  test('memory() resolves to a Messaging with settled, messages, messagesOf, deliver, redeliver and pending', () => {
    expectTypeOf(inMemory).toExtend<Messaging<typeof contract>>();
    expectTypeOf(inMemory).toEqualTypeOf<MemoryMessaging<typeof contract>>();
    expectTypeOf(inMemory).toHaveProperty('publisher');
    expectTypeOf(inMemory).toHaveProperty('sender');
    expectTypeOf(inMemory).toHaveProperty('consume');
    expectTypeOf(inMemory).toHaveProperty('close');
    expectTypeOf(inMemory).toHaveProperty('settled');
    expectTypeOf(inMemory).toHaveProperty('messages');
    expectTypeOf(inMemory).toHaveProperty('messagesOf');
    expectTypeOf(inMemory).toHaveProperty('deliver');
    expectTypeOf(inMemory).toHaveProperty('redeliver');
    expectTypeOf(inMemory).toHaveProperty('pending');
    expect(inMemory.publisher).toBeTypeOf('object');
  });

  test('memory()’s result is no Broker: messaging(contract, await memory(contract)) is a type error', () => {
    const connecting = () =>
      // @ts-expect-error: memory() runs the Contract's messaging itself, it has no connect
      messaging(contract, inMemory);

    expect(connecting).toBeTypeOf('function');
  });

  test('deliver takes an Event or a Command and resolves to acked, pending or ended', () => {
    const deliveringSubscription = () =>
      // @ts-expect-error: a Subscription is no Message Version to deliver, redeliver() retries
      inMemory.deliver(notifyOnCreated, {});

    expectTypeOf(inMemory.deliver).parameter(0).toEqualTypeOf<Event | Command>();
    expectTypeOf(inMemory.deliver).parameter(2).toEqualTypeOf<DeliveryMeta | undefined>();
    expectTypeOf(inMemory.deliver).returns.resolves.toEqualTypeOf<
      'acked' | 'pending' | 'ended' | 'handed-back'
    >();
    expect(deliveringSubscription).toBeTypeOf('function');
  });

  test('deliver takes the body its Message Version’s writer writes: a misspelled field is a type error', () => {
    const delivering = () =>
      // @ts-expect-error: ordrId is no field of OrderCreated's body
      inMemory.deliver(orderCreatedV1, { ordrId: 'o-1' });

    expectTypeOf(inMemory.deliver<typeof orderCreatedV1>)
      .parameter(1)
      .toEqualTypeOf<{ orderId: string }>();
    expect(delivering).toBeTypeOf('function');
  });

  test('deliver of a Command takes its Message Version’s body type', () => {
    const delivering = () =>
      // @ts-expect-error: amount is no field of ChargeCard's body
      inMemory.deliver(chargeCardV1, { orderId: 'o-1', amount: 12 });

    expectTypeOf(inMemory.deliver<typeof chargeCardV1>)
      .parameter(1)
      .toEqualTypeOf<{ orderId: string }>();
    expect(delivering).toBeTypeOf('function');
  });

  test('deliver of a Provided Event takes its Reader’s body, an Unknown case of an Open Enum included', () => {
    const delivering = () =>
      inMemory.deliver(paymentSettledV1, { paymentId: 'p-1', status: { unknown: 'refunded' } });

    expectTypeOf(inMemory.deliver<typeof paymentSettledV1>)
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
      inMemory.deliver(orderPlacedV1, { orderId: 'o-1', status: { unknown: 'refunded' } });

    expectTypeOf(inMemory.deliver<typeof orderPlacedV1>)
      .parameter(1)
      .toEqualTypeOf<{ orderId: string; status: 'pending' | 'paid' }>();
    expect(delivering).toBeTypeOf('function');
  });

  test('redeliver and settled resolve to nothing', () => {
    expectTypeOf(inMemory.redeliver).returns.resolves.toEqualTypeOf<void>();
    expectTypeOf(inMemory.settled).returns.resolves.toEqualTypeOf<void>();
    expect(inMemory.redeliver).toBeTypeOf('function');
  });

  test('messages and pending list read-only records', () => {
    expectTypeOf(inMemory.messages).toEqualTypeOf<readonly RecordedMessage[]>();
    expectTypeOf(inMemory.pending).toEqualTypeOf<readonly PendingMessage[]>();
    expectTypeOf<PendingMessage['element']>().toEqualTypeOf<Subscription | Command>();
    expectTypeOf<RecordedMessage['body']>().toEqualTypeOf<unknown>();
    expectTypeOf<PendingMessage['body']>().toEqualTypeOf<unknown>();
    expect(inMemory.messages).toEqual([]);
  });

  test('messagesOf lists the Messages of a Message Version, their body typed by it', () => {
    const recorded = inMemory.messagesOf(orderCreatedV1);
    const sent = inMemory.messagesOf(chargeCardV1);

    expectTypeOf(recorded).toEqualTypeOf<readonly RecordedMessage<typeof orderCreatedV1>[]>();
    expectTypeOf(recorded).items.toHaveProperty('body').toEqualTypeOf<{ orderId: string }>();
    expectTypeOf(sent).items.toHaveProperty('body').toEqualTypeOf<{ orderId: string }>();
    expectTypeOf(recorded).items.toExtend<RecordedMessage>();
    expect(recorded).toEqual([]);
  });

  test('memory() has no apply', () => {
    // @ts-expect-error: no broker plan exists to apply
    const apply = inMemory.apply;

    expect(apply).toBeUndefined();
  });
});
