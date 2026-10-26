import { describe, expect, expectTypeOf, test } from 'vitest';
import { z } from 'zod';
import { summaryOf } from '../../test/failures.ts';
import { aProvider } from '../../test/providers.ts';
import { aRootPackage } from '../../test/root-package.ts';
import {
  defineCommand,
  defineDependency,
  defineEndpoint,
  defineEvent,
  defineGroup,
  defineGuard,
  defineRejection,
  defineService,
  defineSubscription,
  type InputOf,
  openEnum,
  openEnumReader,
  type Provided,
  type ProvidedEndpoint,
  providedEndpoint,
  providedEvent,
  providedRejection,
  type SuccessOf,
} from '../index.ts';
import { carriedStandardRejectionsOf, providerOf, validateRoot } from '../internal/index.ts';

const trackOrder = {
  name: 'trackOrder',
  method: 'GET',
  path: '/orders/:orderId/track',
  visibility: 'public',
  description: 'Where an order stands',
  input: { params: z.object({ orderId: z.uuid() }) },
  success: { status: 200, body: z.object({ stage: openEnum(['packed', 'shipped']) }) },
} as const;

const orderPaid = {
  name: 'OrderPaid',
  version: 1,
  visibility: 'internal',
  description: 'An order was paid',
  body: z.object({ stage: openEnum(['packed', 'shipped']) }),
} as const;

const orderLocked = {
  code: 'ORDER_LOCKED',
  status: 409,
  message: 'The order can no longer be changed',
  body: z.object({ reason: openEnum(['paid', 'shipped']) }),
} as const;

const ownEvent = defineEvent({
  name: 'OrderShipped',
  version: 1,
  visibility: 'internal',
  description: 'An order was shipped',
  body: z.object({ orderId: z.uuid() }),
});

const ownEndpoint = defineEndpoint({
  name: 'listOrders',
  method: 'GET',
  path: '/orders',
  visibility: 'public',
  description: 'Every order',
  success: { status: 200, body: z.array(z.object({ id: z.uuid() })) },
});

const ownCommand = defineCommand({
  name: 'ChargeCard',
  version: 1,
  description: 'Charges the order’s card',
  body: z.object({ orderId: z.uuid() }),
});

const ownSubscription = defineSubscription({
  name: 'auditShipped',
  description: 'Audits each shipment',
  event: ownEvent,
});

const pinged = providedEvent('ping-service', {
  name: 'Pinged',
  version: 1,
  visibility: 'internal',
  description: 'The ping-service was pinged',
  body: z.object({ at: z.iso.datetime() }),
});

const ping = providedEndpoint(
  aProvider('ping-service'),
  {
    name: 'ping',
    method: 'GET',
    path: '/ping',
    visibility: 'public',
    description: 'Whether the ping-service is up',
    success: { status: 200, body: z.object({ at: z.iso.datetime() }) },
  },
  undefined,
);

/** The failures `generate` reports for a Group that lists these, as a cast lets an author write them. */
function failuresOfListing(lists: Readonly<Record<string, readonly unknown[]>>) {
  const declaration = { name: 'billing', description: 'Billing', ...lists };
  const group = defineGroup(declaration as unknown as Parameters<typeof defineGroup>[0]);
  const root = defineService({ name: 'billing-service', groups: [group] });
  const validated = validateRoot(root, aRootPackage(root));
  return validated.kind === 'invalid' ? validated.failures.map(summaryOf) : [];
}

describe('the provided-Element constructors', () => {
  test('a provided Endpoint is the declaration, frozen and kept by identity, as defineEndpoint returns it', () => {
    const endpoint = providedEndpoint(aProvider('orders-service'), trackOrder, undefined);

    expect(endpoint).toEqual(defineEndpoint(trackOrder));
    expect(endpoint.success.body).toBe(trackOrder.success.body);
    expect(Object.isFrozen(endpoint)).toBe(true);
  });

  test('a provided Endpoint carries its Provider’s name and Standard Rejections, which its type keeps', () => {
    const orders = aProvider('orders-service');

    const endpoint = providedEndpoint(orders, trackOrder, undefined);

    expect(providerOf(endpoint)).toBe('orders-service');
    expect(carriedStandardRejectionsOf(endpoint)).toBe(orders.standardRejections);
    expectTypeOf(endpoint).toExtend<
      ProvidedEndpoint<typeof endpoint, 'orders-service', typeof orders.standardRejections>
    >();
    expectTypeOf(endpoint).not.toExtend<ProvidedEndpoint<typeof endpoint, 'payments-service'>>();
  });

  test('a provided Event is the declaration, frozen and kept by identity, as defineEvent returns it', () => {
    const event = providedEvent('orders-service', orderPaid);

    expect(event).toEqual(defineEvent(orderPaid));
    expect(event.body).toBe(orderPaid.body);
    expect(Object.isFrozen(event)).toBe(true);
  });

  test('a provided Rejection is the declaration, frozen and kept by identity, as defineRejection returns it', () => {
    const rejection = providedRejection(orderLocked);

    expect(rejection).toEqual(defineRejection(orderLocked));
    expect(rejection.body).toBe(orderLocked.body);
    expect(Object.isFrozen(rejection)).toBe(true);
  });

  test('an Open Enum’s Reader compiles in a provided Endpoint’s Success body, a provided Event’s and a provided Rejection’s', () => {
    const endpoint = providedEndpoint(
      aProvider('orders-service'),
      {
        ...trackOrder,
        success: { status: 200, body: z.object({ stage: openEnumReader(['packed', 'shipped']) }) },
      },
      undefined,
    );
    const event = providedEvent('orders-service', {
      ...orderPaid,
      body: z.object({ stage: openEnumReader(['packed', 'shipped']) }),
    });
    const rejection = providedRejection({
      ...orderLocked,
      body: z.object({ reason: openEnumReader(['paid', 'shipped']) }),
    });

    expect([endpoint.kind, event.kind, rejection.kind]).toEqual(['endpoint', 'event', 'rejection']);
  });

  test('a provided Endpoint types InputOf and SuccessOf as defineEndpoint does', () => {
    const provided = providedEndpoint(aProvider('orders-service'), trackOrder, undefined);
    const defined = defineEndpoint(trackOrder);

    expectTypeOf<InputOf<typeof provided>>().toEqualTypeOf<InputOf<typeof defined>>();
    expectTypeOf<SuccessOf<typeof provided>>().toEqualTypeOf<SuccessOf<typeof defined>>();
    expectTypeOf<typeof provided>().toExtend<typeof defined>();
  });
});

describe('a Provider’s Elements', () => {
  test('a Provider’s Endpoint and Event listed in a Group fail provided-element, naming their Provider', () => {
    const failures = failuresOfListing({ endpoints: [ping], events: [pinged] });

    expect(failures).toEqual([
      {
        kind: 'declaration',
        location: 'groups.billing',
        rule: 'provided-element',
        message: "A Group lists the Contract's own Elements: ping is ping-service's",
      },
      {
        kind: 'declaration',
        location: 'groups.billing',
        rule: 'provided-element',
        message: "A Group lists the Contract's own Elements: Pinged@1 is ping-service's",
      },
    ]);
  });

  test.each([
    { kind: 'an Endpoint', lists: { endpoints: [ownEndpoint] } },
    { kind: 'an Event', lists: { events: [ownEvent] } },
    { kind: 'a Command', lists: { commands: [ownCommand] } },
    { kind: 'a Subscription', lists: { events: [ownEvent], subscriptions: [ownSubscription] } },
  ])('$kind from any other define* is nobody’s Provider’s: a Group lists it', ({ lists }) => {
    const failures = failuresOfListing(lists);

    expect(failures).toEqual([]);
  });

  test.each([
    { kind: 'a Guard', value: defineGuard({ name: 'apiKey', description: 'An API key' }) },
    { kind: 'a Rejection', value: defineRejection({ code: 'LOCKED', status: 409, message: 'No' }) },
    { kind: 'a Dependency', value: defineDependency({ endpoints: [ping] }) },
  ])('$kind listed where an Element belongs is no Provider’s Element', ({ value }) => {
    const failures = failuresOfListing({ endpoints: [value] });

    expect(failures.map((failure) => failure.kind === 'declaration' && failure.rule)).toEqual([
      'not-a-declaration',
    ]);
  });
});

describe('the types of a Provider’s Elements', () => {
  test('defineGroup refuses a Provider’s Endpoint and a Provider’s Event', () => {
    const declare = () => [
      defineGroup({
        name: 'billing',
        description: 'Billing',
        // @ts-expect-error a Group lists its Contract’s own Elements
        endpoints: [ping],
      }),
      defineGroup({
        name: 'billing',
        description: 'Billing',
        // @ts-expect-error a Group lists its Contract’s own Elements
        events: [pinged],
      }),
    ];

    expect(declare).not.toThrow();
  });

  test('defineGroup refuses a Provider’s Element beside an own one', () => {
    const declare = () => [
      defineGroup({
        name: 'billing',
        description: 'Billing',
        // @ts-expect-error a Group lists its Contract’s own Elements
        endpoints: [ownEndpoint, ping],
      }),
      defineGroup({
        name: 'billing',
        description: 'Billing',
        // @ts-expect-error a Group lists its Contract’s own Elements
        events: [pinged, ownEvent],
      }),
    ];

    expect(declare).not.toThrow();
  });

  test('defineGroup keeps the exact types of the own Elements it lists', () => {
    const group = defineGroup({
      name: 'orders',
      description: 'Orders',
      endpoints: [ownEndpoint],
      events: [ownEvent],
      commands: [ownCommand],
      subscriptions: [ownSubscription],
    });

    expectTypeOf(group.endpoints).toEqualTypeOf<readonly [typeof ownEndpoint]>();
    expectTypeOf(group.events).toEqualTypeOf<readonly [typeof ownEvent]>();
    expectTypeOf(group.commands).toEqualTypeOf<readonly [typeof ownCommand]>();
    expectTypeOf(group.subscriptions).toEqualTypeOf<readonly [typeof ownSubscription]>();
  });

  test('a Dependency and a Subscription take a Provider’s Elements, and InputOf and SuccessOf type them', () => {
    const dependency = defineDependency({ endpoints: [ping] });
    const subscription = defineSubscription({
      name: 'onPinged',
      description: 'Reacts to each ping',
      event: pinged,
    });

    expectTypeOf(dependency.endpoints).toEqualTypeOf<readonly [typeof ping]>();
    expectTypeOf(subscription.event).toEqualTypeOf<typeof pinged>();
    expectTypeOf<SuccessOf<typeof ping>['body']>().toEqualTypeOf<{ at: string }>();
    expectTypeOf<keyof InputOf<typeof ping>>().toEqualTypeOf<never>();
  });

  test('a Provided Element is the Element and the Provider’s mark', () => {
    expectTypeOf(ping).toExtend<Provided<typeof ping>>();
    expectTypeOf(ownEndpoint).not.toExtend<Provided<typeof ownEndpoint>>();
  });
});
