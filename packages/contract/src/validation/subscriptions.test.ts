import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import {
  type ContractPackage,
  defineContract,
  defineDependency,
  defineEvent,
  defineGroup,
  defineSubscription,
  type Event,
  type Subscription,
} from '../index.ts';
import { validateContract } from '../internal/index.ts';

const orderCreatedV1 = defineEvent({
  name: 'OrderCreated',
  version: 1,
  visibility: 'internal',
  description: 'An order was placed',
  body: z.object({ orderId: z.uuid() }),
});

const paymentSettledV1 = defineEvent({
  name: 'PaymentSettled',
  version: 1,
  visibility: 'internal',
  description: 'A payment was settled',
  body: z.object({ paymentId: z.uuid() }),
});

const paymentFailedV1 = defineEvent({
  name: 'PaymentFailed',
  version: 1,
  visibility: 'internal',
  description: 'A payment failed',
  body: z.object({ paymentId: z.uuid() }),
});

const payments = {
  name: 'payments-service',
  version: '5.1.0',
  endpoints: {},
  events: { paymentSettledV1, paymentFailedV1 },
  standardRejections: {
    invalidInput: { code: 'INVALID_INPUT', status: 400, message: 'Invalid input' },
    notFound: { code: 'NOT_FOUND', status: 404, message: 'Not found' },
    notImplemented: { code: 'NOT_IMPLEMENTED', status: 501, message: 'Not implemented' },
  },
  exportedSnapshot: { format: 1, defs: {}, endpoints: {}, events: {}, guards: {}, codes: {} },
} as const satisfies ContractPackage;

/** A Subscription the types refuse, as a cast lets an author write it. */
function aSubscription(name: string, event: unknown): Subscription {
  const declaration = { name, description: 'Receives it', event };
  return defineSubscription(declaration as unknown as Parameters<typeof defineSubscription>[0]);
}

function validateSubscriptions(
  subscriptions: readonly Subscription[],
  events: readonly Event[] = [orderCreatedV1],
  provider: typeof payments = payments,
) {
  const ordersGroup = defineGroup({
    name: 'orders',
    description: 'Orders',
    events,
    subscriptions,
  } as unknown as Parameters<typeof defineGroup>[0]);
  const contract = defineContract({
    name: 'orders-service',
    groups: [ordersGroup],
    dependencies: [defineDependency({ provider })],
  });
  return validateContract(contract, {
    originOf: () => undefined,
    packageName: 'orders-service',
    exportsOf: () => [],
  });
}

const notifyOnSettled = defineSubscription({
  name: 'notifyOnSettled',
  description: 'Receives it',
  event: payments.events.paymentSettledV1,
});

function failed(at: readonly (string | number)[], rule: string, message: string) {
  return { kind: 'invalid', failures: [{ kind: 'declaration', at, rule, message }] };
}

describe('validateContract: Subscriptions', () => {
  test('a Subscription to the Service’s own Event validates', () => {
    const audit = defineSubscription({
      name: 'auditOrders',
      description: 'Receives it',
      event: orderCreatedV1,
    });

    const result = validateSubscriptions([notifyOnSettled, audit]);

    expect(result.kind).toBe('valid');
  });

  test('a Subscription to an Event a listed Dependency’s Provider exports validates', () => {
    const onFailed = defineSubscription({
      name: 'onFailed',
      description: 'Receives it',
      event: payments.events.paymentFailedV1,
    });

    const result = validateSubscriptions([notifyOnSettled, onFailed]);

    expect(result.kind).toBe('valid');
  });

  test('a Subscription to an Event the root does not list fails', () => {
    const audit = defineSubscription({
      name: 'auditOrders',
      description: 'Receives it',
      event: orderCreatedV1,
    });

    const result = validateSubscriptions([notifyOnSettled, audit], []);

    expect(result).toEqual(
      failed(
        ['groups', 'orders', 'subscriptions', 'auditOrders', 'event'],
        'subscription-event',
        "A Subscription's Event is the Service's own or one a listed Dependency's Provider exports: OrderCreated@1",
      ),
    );
  });

  test('a Subscription to an Event of a Provider no Dependency lists fails', () => {
    const shippedV1 = defineEvent({
      name: 'Shipped',
      version: 1,
      visibility: 'internal',
      description: 'An order was shipped',
      body: z.object({ orderId: z.uuid() }),
    });
    const onShipped = defineSubscription({
      name: 'onShipped',
      description: 'Receives it',
      event: shippedV1,
    });

    const result = validateSubscriptions([notifyOnSettled, onShipped]);

    expect(result).toEqual(
      failed(
        ['groups', 'orders', 'subscriptions', 'onShipped', 'event'],
        'subscription-event',
        "A Subscription's Event is the Service's own or one a listed Dependency's Provider exports: Shipped@1",
      ),
    );
  });

  test('an Event declared apart with a Provider’s name and version is not the one it exports', () => {
    const lookalike = defineEvent({
      name: 'PaymentFailed',
      version: 1,
      visibility: 'internal',
      description: 'A payment failed',
      body: z.object({ paymentId: z.uuid() }),
    });
    const onFailed = defineSubscription({
      name: 'onFailed',
      description: 'Receives it',
      event: lookalike,
    });

    const result = validateSubscriptions([notifyOnSettled, onFailed]);

    expect(result).toEqual(
      failed(
        ['groups', 'orders', 'subscriptions', 'onFailed', 'event'],
        'subscription-event',
        "A Subscription's Event is the Service's own or one a listed Dependency's Provider exports: PaymentFailed@1",
      ),
    );
  });

  test('a Subscription to a Provider’s Private Event fails, even one the Provider exported', () => {
    const privateEvent = defineEvent({
      name: 'PaymentRefunded',
      version: 1,
      visibility: 'private',
      description: 'A payment was refunded',
      body: z.object({ paymentId: z.uuid() }),
    });
    const provider = {
      ...payments,
      events: { ...payments.events, paymentRefundedV1: privateEvent },
    } as unknown as typeof payments;
    const onRefunded = defineSubscription({
      name: 'onRefunded',
      description: 'Receives it',
      event: privateEvent,
    });

    const result = validateSubscriptions([notifyOnSettled, onRefunded], [orderCreatedV1], provider);

    expect(result).toEqual(
      failed(
        ['groups', 'orders', 'subscriptions', 'onRefunded', 'event'],
        'subscription-event',
        "A Subscription receives another Service's Event only when it is Public or Internal: PaymentRefunded@1 is private",
      ),
    );
  });

  test('a Subscription to a Provider’s Private Event fails even when the Provider bears the Service’s own name', () => {
    const privateEvent = defineEvent({
      name: 'PaymentRefunded',
      version: 1,
      visibility: 'private',
      description: 'A payment was refunded',
      body: z.object({ paymentId: z.uuid() }),
    });
    const provider = {
      ...payments,
      name: 'orders-service',
      events: { ...payments.events, paymentRefundedV1: privateEvent },
    } as unknown as typeof payments;
    const onRefunded = defineSubscription({
      name: 'onRefunded',
      description: 'Receives it',
      event: privateEvent,
    });

    const result = validateSubscriptions([onRefunded], [orderCreatedV1], provider);

    expect(result).toEqual(
      failed(
        ['groups', 'orders', 'subscriptions', 'onRefunded', 'event'],
        'subscription-event',
        "A Subscription receives another Service's Event only when it is Public or Internal: PaymentRefunded@1 is private",
      ),
    );
  });

  test('a Subscription whose event is not an Event fails', () => {
    const notAnEvent = aSubscription('onSomething', { name: 'OrderCreated', version: 1 });

    const result = validateSubscriptions([notifyOnSettled, notAnEvent]);

    expect(result).toEqual(
      failed(
        ['groups', 'orders', 'subscriptions', 'onSomething', 'event'],
        'not-a-declaration',
        'event is not an Event',
      ),
    );
  });

  test('a kebab-case Subscription name fails the camelCase grammar', () => {
    const named = defineSubscription({
      name: 'charge-on-created',
      description: 'Charges the card for each order created',
      event: paymentSettledV1,
    });

    const result = validateSubscriptions([named]);

    expect(result).toEqual(
      failed(
        ['groups', 'orders', 'subscriptions', 'charge-on-created', 'name'],
        'name-grammar',
        'A Subscription name is camelCase: charge-on-created',
      ),
    );
  });

  test.each([
    ['NotifyOnSettled', 'A Subscription name is camelCase: NotifyOnSettled'],
    ['1stAudit', 'A Subscription name is camelCase: 1stAudit'],
    ['delete', 'A Subscription name is camelCase and no reserved word: delete'],
    ['handle', 'A Subscription name is camelCase and no reserved word: handle'],
    ['then', 'A Subscription name is camelCase and no reserved word: then'],
    ['toJSON', 'A Subscription name is camelCase and no reserved word: toJSON'],
  ])('a Subscription name %s, which code cannot name, fails the name grammar', (name, message) => {
    const named = defineSubscription({
      name,
      description: 'Receives it',
      event: paymentSettledV1,
    });

    const result = validateSubscriptions([named]);

    expect(result).toEqual(
      failed(['groups', 'orders', 'subscriptions', name, 'name'], 'name-grammar', message),
    );
  });

  test('two Subscriptions with one name fail', () => {
    const again = defineSubscription({
      name: 'notifyOnSettled',
      description: 'Receives it',
      event: orderCreatedV1,
    });

    const result = validateSubscriptions([notifyOnSettled, again]);

    expect(result).toEqual(
      failed(
        ['groups', 'orders', 'subscriptions', 'notifyOnSettled', 'name'],
        'duplicate-subscription-name',
        'A Subscription name is unique in the Service: notifyOnSettled',
      ),
    );
  });

  test('a Subscription to the Service’s own Retired Event fails', () => {
    const retiredV1 = defineEvent({
      name: 'OrderCreated',
      version: 1,
      visibility: 'internal',
      description: 'An order was placed',
      lifecycle: 'retired',
      body: z.object({ orderId: z.uuid() }),
    });
    const audit = aSubscription('auditOrders', retiredV1);

    const result = validateSubscriptions([notifyOnSettled, audit], [retiredV1]);

    expect(result).toEqual(
      failed(
        ['groups', 'orders', 'subscriptions', 'auditOrders', 'event'],
        'retired-event-subscribed',
        "A Subscription's Event is not Retired: OrderCreated@1",
      ),
    );
  });

  test('an Event declared by another copy of @cf-loom/contract is an Event', () => {
    const copied = {
      kind: 'event',
      name: 'OrderShipped',
      version: 1,
      visibility: 'internal',
      description: 'An order was shipped',
      body: z.object({ orderId: z.uuid() }),
    } as const;
    Object.defineProperty(copied, Symbol.for('@cf-loom/contract.declaration'), { value: true });
    const onShipped = defineSubscription({
      name: 'onShipped',
      description: 'Receives it',
      event: copied,
    });

    const result = validateSubscriptions([notifyOnSettled, onShipped], [copied]);

    expect(result.kind).toBe('valid');
  });

  test('a Subscription without an event fails as a required field', () => {
    const withoutEvent = aSubscription('onNothing', undefined);

    const result = validateSubscriptions([notifyOnSettled, withoutEvent]);

    expect(result).toEqual(
      failed(
        ['groups', 'orders', 'subscriptions', 'onNothing', 'event'],
        'required-field',
        'event is a required field',
      ),
    );
  });

  test('a Subscription without a description fails as a required string', () => {
    const declaration = { name: 'onNothing', event: orderCreatedV1 };
    const withoutDescription = defineSubscription(
      declaration as unknown as Parameters<typeof defineSubscription>[0],
    );

    const result = validateSubscriptions([notifyOnSettled, withoutDescription]);

    expect(result).toEqual(
      failed(
        ['groups', 'orders', 'subscriptions', 'onNothing', 'description'],
        'required-field',
        'description is a required string',
      ),
    );
  });

  test('an undeclared field on a Subscription fails', () => {
    const declaration = {
      name: 'onCreated',
      description: 'Receives it',
      event: orderCreatedV1,
      filter: 'eu',
    };
    const filtered = defineSubscription(
      declaration as unknown as Parameters<typeof defineSubscription>[0],
    );

    const result = validateSubscriptions([notifyOnSettled, filtered]);

    expect(result).toEqual(
      failed(
        ['groups', 'orders', 'subscriptions', 'onCreated', 'filter'],
        'undeclared-field',
        'filter is not a declared field',
      ),
    );
  });
});
