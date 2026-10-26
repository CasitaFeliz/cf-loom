import { describe, expect, expectTypeOf, test } from 'vitest';
import {
  canonicalTextOf,
  decodeSnapshot,
  type EndpointSnapshot,
  type EndpointTombstone,
  type EventSnapshot,
  hashedTextOf,
  isDeclared,
  type PublishedEndpoint,
  type PublishedEvent,
  type PublishedServiceSnapshot,
  type PublishedSnapshot,
  type ServiceSnapshot,
  type SubscriptionSnapshot,
} from '../internal/index.ts';

const invalidInputCode = 'INVALID_INPUT';
const notFoundCode = 'NOT_FOUND';
const notImplementedCode = 'NOT_IMPLEMENTED';

const standardCodes = {
  [invalidInputCode]: {
    origin: 'standard',
    status: 400,
    message: 'Invalid',
    headers: { type: 'object', fields: {} },
    body: { type: 'object', fields: {} },
  },
  [notFoundCode]: {
    origin: 'standard',
    status: 404,
    message: 'Not found',
    headers: { type: 'object', fields: {} },
    body: null,
  },
  [notImplementedCode]: {
    origin: 'standard',
    status: 501,
    message: 'No',
    headers: { type: 'object', fields: {} },
    body: null,
  },
} as const;

function aPublishedService(
  fields: Partial<PublishedServiceSnapshot> = {},
): PublishedServiceSnapshot {
  return {
    format: 1,
    kind: 'service',
    name: 'orders-service',
    version: '3.4.0',
    generator: '@cf-loom/cli@2.1.0',
    standardRejections: {
      invalidInput: invalidInputCode,
      notFound: notFoundCode,
      notImplemented: notImplementedCode,
    },
    groups: { orders: { description: 'Orders' } },
    defs: {},
    endpoints: {},
    events: {},
    commands: {},
    guards: {},
    codes: standardCodes,
    subscriptions: {},
    dependencies: {},
    ...fields,
  };
}

const getOrder = {
  name: 'getOrder',
  group: 'orders',
  visibility: 'public',
  lifecycle: 'active',
  description: 'One order',
  params: ['orderId'],
  guards: [],
  input: {
    params: { type: 'object', fields: { orderId: { required: true, schema: { type: 'string' } } } },
    query: { type: 'object', fields: {} },
    headers: { type: 'object', fields: {} },
    body: null,
  },
  success: { status: 200, headers: { type: 'object', fields: {} }, body: null },
  rejections: [],
} as const satisfies EndpointSnapshot;

const orderPlaced = {
  group: 'orders',
  visibility: 'internal',
  lifecycle: 'active',
  description: 'An order was placed',
  body: { type: 'object', fields: {} },
} as const satisfies EventSnapshot;

const retiredGetOrder = { ...getOrder, lifecycle: 'retired', retiredIn: '3.0.0' } as const;
const tombstone = { lifecycle: 'retired', retiredIn: '3.0.0' } as const;
const endpointTombstone = { ...tombstone, name: 'purgeOrders' } as const;

describe('isDeclared', () => {
  test('a still-declared Endpoint is declared, Retired or not; its tombstone is not', () => {
    const endpoints: readonly PublishedEndpoint[] = [getOrder, retiredGetOrder, endpointTombstone];

    const declared = endpoints.map((endpoint) => isDeclared(endpoint));

    expect(declared).toEqual([true, true, false]);
  });

  test('a still-declared Event and Command Version is declared, Retired or not; a tombstone is not', () => {
    const events: readonly PublishedEvent[] = [
      orderPlaced,
      { ...orderPlaced, lifecycle: 'retired', retiredIn: '3.0.0' },
      tombstone,
    ];

    const declared = events.map((event) => isDeclared(event));

    expect(declared).toEqual([true, true, false]);
  });
});

describe('the published Snapshot', () => {
  test('its hash leaves out version and generator', () => {
    const published = aPublishedService({ endpoints: { 'GET /orders/{}': getOrder } });
    const republished = { ...published, version: '3.5.0', generator: '@cf-loom/cli@9.9.9' };

    const hashed = hashedTextOf(republished);

    expect(hashed).toBe(hashedTextOf(published));
  });

  test('its hash covers a tombstone and the retiredIn of a Retired Element', () => {
    const published = aPublishedService({ endpoints: { 'GET /orders/{}': retiredGetOrder } });
    const withTombstone = aPublishedService({
      endpoints: { 'GET /orders/{}': retiredGetOrder, 'DELETE /orders/{}': endpointTombstone },
    });
    const retiredLater = aPublishedService({
      endpoints: { 'GET /orders/{}': { ...retiredGetOrder, retiredIn: '3.1.0' } },
    });

    const hashes = [published, withTombstone, retiredLater].map(hashedTextOf);

    expect(new Set(hashes).size).toBe(3);
  });

  test('the canonical text of a published Snapshot decodes back to it', () => {
    const published = aPublishedService({
      endpoints: { 'GET /orders/{}': retiredGetOrder, 'DELETE /orders/{}': endpointTombstone },
      events: { 'OrderPlaced@1': orderPlaced, 'OrderPurged@1': tombstone },
      subscriptions: {
        legacySync: { event: 'orders-service:OrderPlaced@1', removedIn: '3.2.0' },
      },
    });

    const decoded = decodeSnapshot(canonicalTextOf(published));

    expect(decoded).toEqual({ kind: 'decoded', snapshot: published });
  });
});

describe('the published Snapshot’s types', () => {
  test('isDeclared narrows a published Endpoint to a declared one and the rest to its tombstone', () => {
    const endpoint: PublishedEndpoint = endpointTombstone;

    if (isDeclared(endpoint)) {
      expectTypeOf(endpoint.description).toBeString();
    } else {
      expectTypeOf(endpoint).toEqualTypeOf<EndpointTombstone>();
    }

    expect(isDeclared(endpoint)).toBe(false);
  });

  test('a declared Snapshot is not a published Snapshot: it has no version', () => {
    const { version: _version, ...heading } = aPublishedService();
    const declared: ServiceSnapshot = {
      ...heading,
      endpoints: {},
      events: {},
      commands: {},
      subscriptions: {},
    };

    // @ts-expect-error a declared Snapshot carries no version
    const published: PublishedSnapshot = declared;

    expect(published).toBe(declared);
  });

  test('the Snapshot a decoder returns is a PublishedSnapshot', () => {
    const decoded = decodeSnapshot(canonicalTextOf(aPublishedService()));

    if (decoded.kind === 'decoded') {
      expectTypeOf(decoded.snapshot).toEqualTypeOf<PublishedSnapshot>();
    }

    expect(decoded.kind).toBe('decoded');
  });

  test('a declared Subscription carries no removedIn', () => {
    const subscription: SubscriptionSnapshot = {
      description: 'Receives it',
      event: 'orders-service:OrderPlaced@1',
      // @ts-expect-error removedIn belongs to the published Snapshot's tombstone
      removedIn: '3.2.0',
    };

    expect(subscription.event).toBe('orders-service:OrderPlaced@1');
  });
});
