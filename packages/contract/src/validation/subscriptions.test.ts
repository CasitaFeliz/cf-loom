import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import {
  type ContractPackage,
  defineContract,
  defineDependencies,
  defineEvent,
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
  exportedSnapshot: { format: 1, defs: {}, endpoints: {}, guards: {}, codes: {} },
} as const satisfies ContractPackage;

const paymentsDeps = defineDependencies(payments, { events: [paymentSettledV1] });

/** A Subscription the types refuse, as a cast lets an author write it. */
function aSubscription(name: string, event: unknown): Subscription {
  return defineSubscription({ name, event } as unknown as Parameters<typeof defineSubscription>[0]);
}

function validateSubscriptions(
  subscriptions: readonly Subscription[],
  events: readonly Event[] = [orderCreatedV1],
) {
  const contract = defineContract({
    name: 'orders-service',
    events,
    subscriptions,
    dependencies: [paymentsDeps],
  });
  return validateContract(contract, {
    originOf: () => undefined,
    packageName: 'orders-service',
    exportsOf: () => [],
  });
}

const notifyOnSettled = defineSubscription({ name: 'notify-on-settled', event: paymentSettledV1 });

function failed(at: readonly (string | number)[], rule: string, message: string) {
  return { kind: 'invalid', failures: [{ kind: 'declaration', at, rule, message }] };
}

describe('validateContract: Subscriptions', () => {
  test('a Subscription to the Service’s own Event validates', () => {
    const audit = defineSubscription({ name: 'audit-orders', event: orderCreatedV1 });

    const result = validateSubscriptions([notifyOnSettled, audit]);

    expect(result.kind).toBe('valid');
  });

  test('a Subscription to an Event listed in a Dependency validates', () => {
    const result = validateSubscriptions([notifyOnSettled]);

    expect(result.kind).toBe('valid');
  });

  test('a Subscription to an Event the root does not list fails', () => {
    const audit = defineSubscription({ name: 'audit-orders', event: orderCreatedV1 });

    const result = validateSubscriptions([notifyOnSettled, audit], []);

    expect(result).toEqual(
      failed(
        ['subscriptions', 'audit-orders', 'event'],
        'subscription-event',
        "A Subscription's Event is the Service's own or one listed in a Dependency: OrderCreated@1",
      ),
    );
  });

  test('a Subscription to a Provider’s Event its Dependency does not list fails', () => {
    const onFailed = defineSubscription({ name: 'on-failed', event: paymentFailedV1 });

    const result = validateSubscriptions([notifyOnSettled, onFailed]);

    expect(result).toEqual(
      failed(
        ['subscriptions', 'on-failed', 'event'],
        'subscription-event',
        "A Subscription's Event is the Service's own or one listed in a Dependency: PaymentFailed@1",
      ),
    );
  });

  test('a Subscription whose event is not an Event fails', () => {
    const notAnEvent = aSubscription('on-something', { name: 'OrderCreated', version: 1 });

    const result = validateSubscriptions([notifyOnSettled, notAnEvent]);

    expect(result).toEqual(
      failed(
        ['subscriptions', 'on-something', 'event'],
        'not-a-declaration',
        'event is not an Event',
      ),
    );
  });

  test('a Subscription name that is not kebab-case fails', () => {
    const named = defineSubscription({ name: 'NotifyOnSettled', event: paymentSettledV1 });

    const result = validateSubscriptions([named]);

    expect(result).toEqual(
      failed(
        ['subscriptions', 'NotifyOnSettled', 'name'],
        'name-grammar',
        'A Subscription name is kebab-case: NotifyOnSettled',
      ),
    );
  });

  test('two Subscriptions with one name fail', () => {
    const again = defineSubscription({ name: 'notify-on-settled', event: orderCreatedV1 });

    const result = validateSubscriptions([notifyOnSettled, again]);

    expect(result).toEqual(
      failed(
        ['subscriptions', 'notify-on-settled', 'name'],
        'duplicate-subscription-name',
        'A Subscription name is unique in the Service: notify-on-settled',
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
    const audit = aSubscription('audit-orders', retiredV1);

    const result = validateSubscriptions([notifyOnSettled, audit], [retiredV1]);

    expect(result).toEqual(
      failed(
        ['subscriptions', 'audit-orders', 'event'],
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
    const onShipped = defineSubscription({ name: 'on-shipped', event: copied });

    const result = validateSubscriptions([notifyOnSettled, onShipped], [copied]);

    expect(result.kind).toBe('valid');
  });

  test('a Subscription without an event fails as a required field', () => {
    const withoutEvent = aSubscription('on-nothing', undefined);

    const result = validateSubscriptions([notifyOnSettled, withoutEvent]);

    expect(result).toEqual(
      failed(
        ['subscriptions', 'on-nothing', 'event'],
        'required-field',
        'event is a required field',
      ),
    );
  });

  test('an undeclared field on a Subscription fails', () => {
    const declaration = { name: 'on-created', event: orderCreatedV1, filter: 'eu' };
    const filtered = defineSubscription(
      declaration as unknown as Parameters<typeof defineSubscription>[0],
    );

    const result = validateSubscriptions([notifyOnSettled, filtered]);

    expect(result).toEqual(
      failed(
        ['subscriptions', 'on-created', 'filter'],
        'undeclared-field',
        'filter is not a declared field',
      ),
    );
  });
});
