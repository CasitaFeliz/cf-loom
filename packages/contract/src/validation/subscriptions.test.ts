import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { summarized } from '../../test/failures.ts';
import { aRootPackage } from '../../test/root-package.ts';
import {
  defineCommand,
  defineEvent,
  defineGroup,
  defineService,
  defineSubscription,
  type Event,
  providedEvent,
  type Subscription,
} from '../index.ts';
import { validateRoot } from '../internal/index.ts';

const orderCreatedV1 = defineEvent({
  name: 'OrderCreated',
  version: 1,
  visibility: 'internal',
  description: 'An order was placed',
  body: z.object({ orderId: z.uuid() }),
});

const paymentSettledV1 = providedEvent('payments-service', {
  name: 'PaymentSettled',
  version: 1,
  visibility: 'internal',
  description: 'A payment was settled',
  body: z.object({ paymentId: z.uuid() }),
});

const paymentFailedV1 = providedEvent('payments-service', {
  name: 'PaymentFailed',
  version: 1,
  visibility: 'internal',
  description: 'A payment failed',
  body: z.object({ paymentId: z.uuid() }),
});

/** A Subscription the types refuse, as a cast lets an author write it. */
function aSubscription(name: string, event: unknown): Subscription {
  const declaration = { name, description: 'Receives it', event };
  return defineSubscription(declaration as unknown as Parameters<typeof defineSubscription>[0]);
}

function validateSubscriptions(
  subscriptions: readonly Subscription[],
  events: readonly Event[] = [orderCreatedV1],
) {
  const ordersGroup = defineGroup({
    name: 'orders',
    description: 'Orders',
    events,
    subscriptions,
  } as unknown as Parameters<typeof defineGroup>[0]);
  const contract = defineService({ name: 'orders-service', groups: [ordersGroup] });
  return summarized(
    validateRoot(contract, aRootPackage(contract, { packageName: 'orders-service' })),
  );
}

const notifyOnSettled = defineSubscription({
  name: 'notifyOnSettled',
  description: 'Receives it',
  event: paymentSettledV1,
});

function failed(location: string, rule: string, message: string) {
  return { kind: 'invalid', failures: [{ kind: 'declaration', location, rule, message }] };
}

describe('validateRoot: Subscriptions', () => {
  test('a Subscription to the Service’s own Event validates', () => {
    const audit = defineSubscription({
      name: 'auditOrders',
      description: 'Receives it',
      event: orderCreatedV1,
    });

    const result = validateSubscriptions([notifyOnSettled, audit]);

    expect(result.kind).toBe('valid');
  });

  test('a Subscription to an Event another Service’s Contract Package exports validates, with no Dependency', () => {
    const onFailed = defineSubscription({
      name: 'onFailed',
      description: 'Receives it',
      event: paymentFailedV1,
    });

    const result = validateSubscriptions([notifyOnSettled, onFailed]);

    expect(result.kind).toBe('valid');
  });

  test('a Subscription to an Event the Root does not list fails', () => {
    const audit = defineSubscription({
      name: 'auditOrders',
      description: 'Receives it',
      event: orderCreatedV1,
    });

    const result = validateSubscriptions([notifyOnSettled, audit], []);

    expect(result).toEqual(
      failed(
        'subscriptions.auditOrders event',
        'subscription-event',
        "A Subscription's Event is the Service's own or one another Service's Contract Package exports: OrderCreated@1",
      ),
    );
  });

  test('a Subscription to an Event no Group lists and no Provider marks fails', () => {
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
        'subscriptions.onShipped event',
        'subscription-event',
        "A Subscription's Event is the Service's own or one another Service's Contract Package exports: Shipped@1",
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
        'subscriptions.onFailed event',
        'subscription-event',
        "A Subscription's Event is the Service's own or one another Service's Contract Package exports: PaymentFailed@1",
      ),
    );
  });

  test('a Subscription to a Provider’s Private Event fails', () => {
    const privateEvent = providedEvent('payments-service', {
      name: 'PaymentRefunded',
      version: 1,
      visibility: 'private',
      description: 'A payment was refunded',
      body: z.object({ paymentId: z.uuid() }),
    });
    const onRefunded = defineSubscription({
      name: 'onRefunded',
      description: 'Receives it',
      event: privateEvent,
    });

    const result = validateSubscriptions([notifyOnSettled, onRefunded]);

    expect(result).toEqual(
      failed(
        'subscriptions.onRefunded event',
        'subscription-event',
        "A Subscription receives another Service's Event only when it is Public or Internal: PaymentRefunded@1 is private",
      ),
    );
  });

  test('a Subscription to an Event of the Service’s own Contract Package fails: a Provider is another Service', () => {
    const ownEvent = providedEvent('orders-service', {
      name: 'PaymentRefunded',
      version: 1,
      visibility: 'private',
      description: 'A payment was refunded',
      body: z.object({ paymentId: z.uuid() }),
    });
    const onRefunded = defineSubscription({
      name: 'onRefunded',
      description: 'Receives it',
      event: ownEvent,
    });

    const result = validateSubscriptions([onRefunded]);

    expect(result).toEqual(
      failed(
        'subscriptions.onRefunded event',
        'subscription-event',
        'A Provider is another Service: orders-service is this Service',
      ),
    );
  });

  test('a Subscription whose event is not an Event fails', () => {
    const notAnEvent = aSubscription('onSomething', { name: 'OrderCreated', version: 1 });

    const result = validateSubscriptions([notifyOnSettled, notAnEvent]);

    expect(result).toEqual(
      failed('subscriptions.onSomething event', 'not-a-declaration', 'event is not an Event'),
    );
  });

  test("a Subscription whose event is a Command fails, saying a Command's Message Version has its own Message Handler", () => {
    const chargeCardV1 = defineCommand({
      name: 'ChargeCard',
      version: 1,
      description: 'Charges the order’s card',
      body: z.object({ orderId: z.uuid() }),
    });
    const subscribedToCommand = aSubscription('onCharge', chargeCardV1);

    const result = validateSubscriptions([notifyOnSettled, subscribedToCommand]);

    expect(result).toEqual(
      failed(
        'subscriptions.onCharge event',
        'not-a-declaration',
        "A Subscription receives an Event; a Command's Message Version has its own Message Handler",
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
        'subscriptions.charge-on-created name',
        'name-grammar',
        'A Subscription name is camelCase words: "charge-on-created"',
      ),
    );
  });

  test.each([
    ['NotifyOnSettled', 'A Subscription name is camelCase words: "NotifyOnSettled"'],
    ['1stAudit', 'A Subscription name is camelCase words: "1stAudit"'],
    ['delete', 'A Subscription name is camelCase words and no reserved word: "delete"'],
    ['handle', 'A Subscription name is camelCase words and no reserved word: "handle"'],
    ['then', 'A Subscription name is camelCase words and no reserved word: "then"'],
    [
      'toJSON',
      'A Subscription name is camelCase words and no reserved word: "toJSON" (write toJson)',
    ],
    ['notifyOnURL', 'A Subscription name is camelCase words: "notifyOnURL" (write notifyOnUrl)'],
    ['notifyOnX', 'A Subscription name is camelCase words: "notifyOnX"'],
  ])('a Subscription name %s, which code cannot name, fails the name grammar', (name, message) => {
    const named = defineSubscription({
      name,
      description: 'Receives it',
      event: paymentSettledV1,
    });

    const result = validateSubscriptions([named]);

    expect(result).toEqual(failed(`subscriptions.${name} name`, 'name-grammar', message));
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
        'subscriptions.notifyOnSettled name',
        'duplicate-subscription-name',
        'A Subscription name is unique in the Service: "notifyOnSettled"',
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
        'subscriptions.auditOrders event',
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
      failed('subscriptions.onNothing event', 'required-field', 'event is a required field'),
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
        'subscriptions.onNothing description',
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
        'subscriptions.onCreated filter',
        'undeclared-field',
        'filter is not a declared field',
      ),
    );
  });
});
