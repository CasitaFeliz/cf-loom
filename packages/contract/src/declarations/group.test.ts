import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import {
  defineCommand,
  defineEndpoint,
  defineEvent,
  defineGroup,
  defineSubscription,
} from '../index.ts';

const listOrders = defineEndpoint({
  name: 'listOrders',
  method: 'GET',
  path: '/orders',
  visibility: 'public',
  description: 'Every order',
  success: { status: 200, body: z.array(z.object({ id: z.uuid() })) },
});

const orderCreatedV1 = defineEvent({
  name: 'OrderCreated',
  version: 1,
  visibility: 'internal',
  description: 'An order was placed',
  body: z.object({ orderId: z.uuid() }),
});

const chargeCardV1 = defineCommand({
  name: 'ChargeCard',
  version: 1,
  description: 'Charges the order’s card',
  body: z.object({ orderId: z.uuid() }),
});

const notifyOnCreated = defineSubscription({
  name: 'notifyOnCreated',
  description: 'Notifies the customer of each order created',
  event: orderCreatedV1,
});

describe('defineGroup', () => {
  test('a Group keeps its Endpoints by identity', () => {
    const ordersGroup = defineGroup({
      name: 'orders',
      description: 'Order lifecycle',
      endpoints: [listOrders],
    });

    expect(ordersGroup.endpoints[0]).toBe(listOrders);
    expect(ordersGroup.kind).toBe('group');
  });

  test('a Group keeps its Events, Commands and Subscriptions by identity', () => {
    const ordersGroup = defineGroup({
      name: 'orders',
      description: 'Order lifecycle',
      events: [orderCreatedV1],
      commands: [chargeCardV1],
      subscriptions: [notifyOnCreated],
    });

    expect(ordersGroup.events[0]).toBe(orderCreatedV1);
    expect(ordersGroup.commands[0]).toBe(chargeCardV1);
    expect(ordersGroup.subscriptions[0]).toBe(notifyOnCreated);
  });

  test('a Group may list Messages and no Endpoint', () => {
    const ordersGroup = defineGroup({
      name: 'orders',
      description: 'Order lifecycle',
      events: [orderCreatedV1],
    });

    expect(ordersGroup).not.toHaveProperty('endpoints');
  });

  test('a Group that lists nothing is a type error', () => {
    // @ts-expect-error a Group lists at least one Endpoint, Event, Command or Subscription
    const declare = () => defineGroup({ name: 'orders', description: 'Order lifecycle' });

    expect(declare).not.toThrow();
  });

  test.each([
    [
      'endpoints',
      () =>
        defineGroup({
          name: 'orders',
          description: 'Orders',
          events: [orderCreatedV1],
          // @ts-expect-error a list in a Group is never empty
          endpoints: [],
        }),
    ],
    [
      'events',
      () =>
        defineGroup({
          name: 'orders',
          description: 'Orders',
          endpoints: [listOrders],
          // @ts-expect-error a list in a Group is never empty
          events: [],
        }),
    ],
    [
      'commands',
      () =>
        defineGroup({
          name: 'orders',
          description: 'Orders',
          endpoints: [listOrders],
          // @ts-expect-error a list in a Group is never empty
          commands: [],
        }),
    ],
    [
      'subscriptions',
      () =>
        defineGroup({
          name: 'orders',
          description: 'Orders',
          endpoints: [listOrders],
          // @ts-expect-error a list in a Group is never empty
          subscriptions: [],
        }),
    ],
  ])('an empty %s list in a Group is a type error', (_field, declare) => {
    expect(declare).not.toThrow();
  });
});

describe('defineGroup fields', () => {
  test('an undeclared field is a type error', () => {
    const declare = () =>
      defineGroup({
        name: 'orders',
        description: 'Order lifecycle',
        endpoints: [listOrders],
        // @ts-expect-error a Group adds no prefix
        prefix: '/orders',
      });

    expect(declare).not.toThrow();
  });
});

describe('a declared Group’s containers', () => {
  test('a Group freezes each list it holds', () => {
    const endpoints: [typeof listOrders, ...(typeof listOrders)[]] = [listOrders];
    const events: [typeof orderCreatedV1, ...(typeof orderCreatedV1)[]] = [orderCreatedV1];

    const ordersGroup = defineGroup({
      name: 'orders',
      description: 'Order lifecycle',
      endpoints,
      events,
    });
    endpoints.pop();
    events.pop();

    expect(ordersGroup.endpoints).toEqual([listOrders]);
    expect(ordersGroup.events).toEqual([orderCreatedV1]);
    expect(Object.isFrozen(ordersGroup.endpoints)).toBe(true);
    expect(Object.isFrozen(ordersGroup.events)).toBe(true);
  });
});
