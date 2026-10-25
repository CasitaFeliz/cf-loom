import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { aRootPackage } from '../../test/root-package.ts';
import {
  defineCommand,
  defineContract,
  defineEndpoint,
  defineEvent,
  defineGroup,
  defineSubscription,
  type Group,
} from '../index.ts';
import { validateContract } from '../internal/index.ts';

const listOrders = defineEndpoint({
  name: 'listOrders',
  method: 'GET',
  path: '/orders',
  visibility: 'public',
  description: 'Every order',
  success: { status: 200, body: z.array(z.object({ id: z.uuid() })) },
});

const orderCreatedV2 = defineEvent({
  name: 'OrderCreated',
  version: 2,
  visibility: 'internal',
  description: 'An order was placed',
  body: z.object({ orderId: z.uuid() }),
});

const chargeCardV1 = defineCommand({
  name: 'ChargeCard',
  version: 1,
  lifecycle: 'deprecated',
  description: 'Charges the order’s card',
  body: z.object({ orderId: z.uuid() }),
});

const chargeCardV2 = defineCommand({
  name: 'ChargeCard',
  version: 2,
  description: 'Charges the order’s card, in cents',
  body: z.object({ orderId: z.uuid(), cents: z.int() }),
});

const notifyOnCreated = defineSubscription({
  name: 'notifyOnCreated',
  description: 'Notifies the customer of each order created',
  event: orderCreatedV2,
});

/** A Group as a cast lets an author write it, whatever its lists hold. */
function aGroup(name: string, lists: Readonly<Record<string, unknown>>): Group {
  const declaration = { name, description: 'Orders', ...lists };
  return defineGroup(declaration as unknown as Parameters<typeof defineGroup>[0]);
}

function validateRoot(root: unknown) {
  return validateContract(root, aRootPackage(root, { packageName: 'orders-service' }));
}

function validateGroups(groups: readonly Group[]) {
  return validateRoot(defineContract({ name: 'orders-service', groups }));
}

function failed(at: readonly (string | number)[], rule: string, message: string) {
  return { kind: 'invalid', failures: [{ kind: 'declaration', at, rule, message }] };
}

describe('validateContract: what a Group lists', () => {
  test('a Group of Messages and a Group of Endpoints validate', () => {
    const result = validateGroups([
      aGroup('orders', { endpoints: [listOrders] }),
      aGroup('payments', { events: [orderCreatedV2], commands: [chargeCardV2] }),
    ]);

    expect(result.kind).toBe('valid');
  });

  test('a Group that lists nothing fails at the Group', () => {
    const result = validateGroups([aGroup('orders', {})]);

    expect(result).toEqual(
      failed(
        ['groups', 'orders'],
        'empty-group',
        'A Group lists at least one Endpoint, Event, Command or Subscription',
      ),
    );
  });

  test('a Group whose every list is empty lists nothing', () => {
    const result = validateGroups([aGroup('orders', { endpoints: [], events: [] })]);

    expect(result).toEqual(
      failed(
        ['groups', 'orders'],
        'empty-group',
        'A Group lists at least one Endpoint, Event, Command or Subscription',
      ),
    );
  });

  test('a Group whose only field is no list fails as not-a-list alone', () => {
    const result = validateGroups([aGroup('orders', { events: {} })]);

    expect(result).toEqual(
      failed(['groups', 'orders', 'events'], 'not-a-list', 'events is a list'),
    );
  });

  test('an empty list beside a list that holds something validates', () => {
    const result = validateGroups([aGroup('orders', { endpoints: [listOrders], events: [] })]);

    expect(result.kind).toBe('valid');
  });

  test.each(['endpoints', 'events', 'commands', 'subscriptions'])(
    'a Group’s %s that is no list fails',
    (field) => {
      const lists = { endpoints: [listOrders], events: [orderCreatedV2], [field]: {} };

      const result = validateGroups([aGroup('orders', lists)]);

      expect(result).toEqual(
        failed(['groups', 'orders', field], 'not-a-list', `${field} is a list`),
      );
    },
  );

  test.each([
    ['endpoints', 'an Endpoint', orderCreatedV2],
    ['events', 'an Event', chargeCardV2],
    ['commands', 'a Command', orderCreatedV2],
    ['subscriptions', 'a Subscription', listOrders],
  ])('something listed under %s that is not %s fails', (field, noun, item) => {
    const result = validateGroups([aGroup('orders', { [field]: [item] })]);

    expect(result).toEqual(
      failed(['groups', 'orders', field, 0], 'not-a-declaration', `${field}.0 is not ${noun}`),
    );
  });

  test.each(['events', 'commands', 'subscriptions'])(
    'a root that still lists %s fails as an undeclared field',
    (field) => {
      const groups = [aGroup('orders', { endpoints: [listOrders] })];
      const root = defineContract({ name: 'orders-service', groups, [field]: [] } as never);

      expect(validateRoot(root)).toEqual(
        failed([field], 'undeclared-field', `${field} is not a declared field`),
      );
    },
  );
});

describe('validateContract: each declaration in exactly one Group', () => {
  test('an Endpoint listed in two Groups fails', () => {
    const result = validateGroups([
      aGroup('orders', { endpoints: [listOrders] }),
      aGroup('sales', { endpoints: [listOrders] }),
    ]);

    expect(result).toEqual(
      failed(
        ['groups', 'sales', 'endpoints', 'GET /orders'],
        'group-membership',
        'An Endpoint belongs to exactly one Group: listOrders is also in orders',
      ),
    );
  });

  test('an Endpoint listed twice in one Group fails', () => {
    const result = validateGroups([aGroup('orders', { endpoints: [listOrders, listOrders] })]);

    expect(result).toEqual(
      failed(
        ['groups', 'orders', 'endpoints', 'GET /orders'],
        'group-membership',
        'An Endpoint belongs to exactly one Group: listOrders is also in orders',
      ),
    );
  });

  test('an Event’s Message Version listed in two Groups fails', () => {
    const result = validateGroups([
      aGroup('orders', { events: [orderCreatedV2] }),
      aGroup('billing', { events: [orderCreatedV2] }),
    ]);

    expect(result).toEqual(
      failed(
        ['groups', 'billing', 'events', 'OrderCreated@2'],
        'group-membership',
        "An Event's Message Version belongs to exactly one Group: OrderCreated@2 is also in orders",
      ),
    );
  });

  test('a Command’s Message Version listed in two Groups fails', () => {
    const result = validateGroups([
      aGroup('orders', { commands: [chargeCardV2] }),
      aGroup('billing', { commands: [chargeCardV2] }),
    ]);

    expect(result).toEqual(
      failed(
        ['groups', 'billing', 'commands', 'ChargeCard@2'],
        'group-membership',
        "A Command's Message Version belongs to exactly one Group: ChargeCard@2 is also in orders",
      ),
    );
  });

  test('a Subscription listed in two Groups fails', () => {
    const result = validateGroups([
      aGroup('orders', { events: [orderCreatedV2], subscriptions: [notifyOnCreated] }),
      aGroup('billing', { subscriptions: [notifyOnCreated] }),
    ]);

    expect(result).toEqual(
      failed(
        ['groups', 'billing', 'subscriptions', 'notifyOnCreated'],
        'group-membership',
        'A Subscription belongs to exactly one Group: notifyOnCreated is also in orders',
      ),
    );
  });

  test('an Event listed twice in one Group fails as Group membership only', () => {
    const result = validateGroups([aGroup('orders', { events: [orderCreatedV2, orderCreatedV2] })]);

    expect(result).toEqual(
      failed(
        ['groups', 'orders', 'events', 'OrderCreated@2'],
        'group-membership',
        "An Event's Message Version belongs to exactly one Group: OrderCreated@2 is also in orders",
      ),
    );
  });

  test('two Message Versions of one Command in two Groups validate', () => {
    const result = validateGroups([
      aGroup('orders', { commands: [chargeCardV1] }),
      aGroup('billing', { commands: [chargeCardV2] }),
    ]);

    expect(result.kind).toBe('valid');
  });

  test('a Subscription to the Service’s own Event that another Group lists validates', () => {
    const result = validateGroups([
      aGroup('orders', { events: [orderCreatedV2] }),
      aGroup('notifications', { subscriptions: [notifyOnCreated] }),
    ]);

    expect(result.kind).toBe('valid');
  });
});
