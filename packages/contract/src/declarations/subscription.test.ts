import { describe, expect, expectTypeOf, test } from 'vitest';
import { z } from 'zod';
import { defineCommand, defineEvent, defineSubscription } from '../index.ts';
import type { Refusal } from '../internal/index.ts';

const body = z.object({ orderId: z.uuid() });

const orderCreatedV1 = defineEvent({
  name: 'OrderCreated',
  version: 1,
  visibility: 'internal',
  description: 'An order was placed',
  body,
});

describe('defineSubscription', () => {
  test('a Subscription keeps its Event itself', () => {
    const notifyOnCreated = defineSubscription({
      name: 'notifyOnCreated',
      description: 'Notifies the customer of each order created',
      event: orderCreatedV1,
    });

    expect(notifyOnCreated.kind).toBe('subscription');
    expect(notifyOnCreated.name).toBe('notifyOnCreated');
    expect(notifyOnCreated.event).toBe(orderCreatedV1);
  });

  test('a Subscription without a description is a type error', () => {
    const declare = () =>
      // @ts-expect-error a Subscription declares what it is for
      defineSubscription({ name: 'notifyOnCreated', event: orderCreatedV1 });

    expect(declare).not.toThrow();
  });

  test('a Subscription named as every object already has is a type error', () => {
    const declare = () =>
      defineSubscription({
        // @ts-expect-error valueOf is a name every object already has
        name: 'valueOf',
        description: 'Notifies the customer of each order created',
        event: orderCreatedV1,
      });

    expect(declare).not.toThrow();
  });

  test('a reserved name’s type error is the line generate writes for it', () => {
    const written = {
      name: 'delete',
      description: 'Notifies the customer of each order created',
      event: orderCreatedV1,
    } as const;
    type Name = Parameters<typeof defineSubscription<typeof written>>[0]['name'];

    expectTypeOf<Name>().toExtend<
      Refusal<'A Subscription name is camelCase words and no reserved word: "delete"'>
    >();
  });

  test('a Subscription to something that is not an Event is a type error', () => {
    const chargeCardV1 = defineCommand({
      name: 'ChargeCard',
      version: 1,
      description: 'Charges the order’s card',
      body,
    });

    const declare = () =>
      // @ts-expect-error a Subscription receives an Event, never a Command
      defineSubscription({ name: 'charge', description: 'Charges', event: chargeCardV1 });

    expect(declare).not.toThrow();
  });

  test('a Subscription to a Command is refused with the reason', () => {
    const chargeCardV1 = defineCommand({
      name: 'ChargeCard',
      version: 1,
      description: 'Charges the order’s card',
      body,
    });
    type Written = Parameters<
      typeof defineSubscription<{
        readonly name: 'charge';
        readonly description: 'Charges';
        readonly event: typeof chargeCardV1;
      }>
    >[0];

    expectTypeOf<Written['event']>().toExtend<
      Refusal<"A Subscription receives an Event; a Command's Message Version has its own Message Handler">
    >();
  });

  test('a Subscription to an Event keeps the Event’s exact type', () => {
    const notifyOnCreated = defineSubscription({
      name: 'notifyOnCreated',
      description: 'Notifies the customer of each order created',
      event: orderCreatedV1,
    });

    expectTypeOf(notifyOnCreated.event).toEqualTypeOf(orderCreatedV1);
    expectTypeOf(notifyOnCreated.event.name).toEqualTypeOf<'OrderCreated'>();
  });

  test('a Subscription to a Retired Event is a type error', () => {
    const retiredV1 = defineEvent({
      name: 'OrderCreated',
      version: 1,
      visibility: 'internal',
      description: 'An order was placed',
      lifecycle: 'retired',
      body,
    });

    const declare = () =>
      defineSubscription({
        name: 'notifyOnCreated',
        description: 'Notifies the customer of each order created',
        // @ts-expect-error a Retired Event is never published
        event: retiredV1,
      });

    expect(declare).not.toThrow();
  });
});
