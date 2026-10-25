import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { defineCommand, defineEvent, defineSubscription } from '../index.ts';

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
