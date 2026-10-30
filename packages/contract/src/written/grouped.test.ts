import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { ping, pingedV1 } from '../../test/ping-package.ts';
import {
  defineCommand,
  defineEndpoint,
  defineEvent,
  defineGroup,
  defineSubscription,
} from '../index.ts';
import { declarationsListedBy, isListable } from '../internal/index.ts';

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

describe('declarationsListedBy', () => {
  test('a Group lists its Endpoints, Events, Commands and Subscriptions, each by identity', () => {
    const orders = defineGroup({
      name: 'orders',
      description: 'Order lifecycle',
      endpoints: [listOrders],
      events: [orderCreatedV1],
      commands: [chargeCardV1],
      subscriptions: [notifyOnCreated],
    });

    const listed = declarationsListedBy(orders);

    expect(listed).toEqual([listOrders, orderCreatedV1, chargeCardV1, notifyOnCreated]);
    expect(listed[0]).toBe(listOrders);
  });

  test('a Group lists only the fields it has', () => {
    const orders = defineGroup({
      name: 'orders',
      description: 'Order lifecycle',
      events: [orderCreatedV1],
    });

    const listed = declarationsListedBy(orders);

    expect(listed).toEqual([orderCreatedV1]);
  });

  test('a cast Group lists only the declarations of each field, and nothing from a field that is no list', () => {
    const cast = defineGroup({
      name: 'orders',
      description: 'Order lifecycle',
      // @ts-expect-error TS2322 an Endpoint list holds Endpoints, and a list is a list
      endpoints: [listOrders, orderCreatedV1, 'listArchived'],
      // @ts-expect-error TS2322 a list is a list
      events: 'orderCreatedV1',
    });

    const listed = declarationsListedBy(cast);

    expect(listed).toEqual([listOrders]);
  });

  test('a Group lists only its Contract’s own declarations: a Provider’s Element, one listed despite the type error, is left out', () => {
    const cast = defineGroup({
      name: 'orders',
      description: 'Order lifecycle',
      // @ts-expect-error TS2322 a Group lists its Contract’s own Elements
      endpoints: [listOrders, ping],
      // @ts-expect-error TS2322 a Group lists its Contract’s own Elements
      events: [pingedV1, orderCreatedV1],
    });

    const listed = declarationsListedBy(cast);

    expect(listed).toEqual([listOrders, orderCreatedV1]);
  });
});

describe('isListable', () => {
  test('an Endpoint, an Event, a Command and a Subscription are listable; a Group and what is no declaration are not', () => {
    const orders = defineGroup({
      name: 'orders',
      description: 'Order lifecycle',
      endpoints: [listOrders],
    });

    const listable = [listOrders, orderCreatedV1, chargeCardV1, notifyOnCreated].map(isListable);
    const others = [orders, 'listOrders', undefined, { kind: 'endpoint' }].map(isListable);

    expect(listable).toEqual([true, true, true, true]);
    expect(others).toEqual([false, false, false, false]);
  });

  test('a Provider’s Element is not listable', () => {
    const listable = [ping, pingedV1].map(isListable);

    expect(listable).toEqual([false, false]);
  });
});
