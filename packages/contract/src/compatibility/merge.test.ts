import { describe, expect, expectTypeOf, test } from 'vitest';
import { publishedAt, publishedBy, schemaExports } from '../../test/snapshots.ts';
import {
  type ApplicationSnapshot,
  type CodeSnapshot,
  type CommandSnapshot,
  canonicalTextOf,
  type DefinitionsSnapshot,
  decodeSnapshot,
  type EndpointSnapshot,
  type EventSnapshot,
  hashedTextOf,
  type PublishedApplicationSnapshot,
  type PublishedDefinitionsSnapshot,
  type PublishedServiceSnapshot,
  type PublishedSnapshot,
  publishedSnapshotOf,
  type ServiceSnapshot,
  type Snapshot,
  type SubscriptionSnapshot,
} from '../internal/index.ts';

const standardRejections: ServiceSnapshot['standardRejections'] = {
  invalidInput: 'INVALID_INPUT',
  notFound: 'NOT_FOUND',
  notImplemented: 'NOT_IMPLEMENTED',
};
type Lifecycle = EndpointSnapshot['lifecycle'];

const orderLocked = 'ORDER_LOCKED';
const orderPaid = 'ORDER_PAID';
const oldCode = 'OLD_CODE';
const keptCode = 'KEPT';
const newCode = 'NEW_CODE';
const emptyObject = { type: 'object', fields: {} } as const;

function anEndpoint(fields: Partial<EndpointSnapshot> = {}): EndpointSnapshot {
  return {
    name: 'getOrder',
    group: 'orders',
    visibility: 'public',
    lifecycle: 'active',
    description: 'One order',
    params: ['orderId'],
    guards: [],
    input: {
      params: {
        type: 'object',
        fields: { orderId: { required: true, schema: { type: 'string' } } },
      },
      query: { type: 'object', fields: {} },
      headers: { type: 'object', fields: {} },
      body: null,
    },
    success: { status: 200, headers: { type: 'object', fields: {} }, body: null },
    rejections: [],
    ...fields,
  };
}

/** The Endpoint on a path with no params, as `POST /orders` has none. */
function withoutParams(endpoint: EndpointSnapshot): EndpointSnapshot {
  return { ...endpoint, params: [], input: { ...endpoint.input, params: null } };
}

function aLive<Element extends { readonly lifecycle: Lifecycle }>(
  element: Element,
  lifecycle: 'active' | 'deprecated' = 'active',
): Element & { readonly lifecycle: 'active' | 'deprecated' } {
  return { ...element, lifecycle };
}

function aRetired<Element extends { readonly lifecycle: Lifecycle }>(
  element: Element,
  retiredIn: string,
): Element & { readonly lifecycle: 'retired'; readonly retiredIn: string } {
  return { ...element, lifecycle: 'retired', retiredIn };
}

function anEvent(fields: Partial<EventSnapshot> = {}): EventSnapshot {
  return {
    group: 'orders',
    visibility: 'internal',
    lifecycle: 'active',
    description: 'An order was placed',
    body: emptyObject,
    ...fields,
  };
}

function aCommand(fields: Partial<CommandSnapshot> = {}): CommandSnapshot {
  return {
    group: 'orders',
    lifecycle: 'active',
    description: 'Charge a card',
    body: emptyObject,
    ...fields,
  };
}

function aSubscription(event: string): SubscriptionSnapshot {
  return { group: 'orders', description: 'Receives it', event };
}

function aCode(fields: Partial<CodeSnapshot> = {}): CodeSnapshot {
  return {
    origin: 'local',
    status: 409,
    message: 'The order can no longer be changed',
    body: null,
    removed: false,
    ...fields,
  };
}

const standardCodes = {
  [standardRejections.invalidInput]: aCode({
    origin: 'standard',
    status: 400,
    message: 'Invalid',
    body: { type: 'object', fields: {} },
  }),
  [standardRejections.notFound]: aCode({ origin: 'standard', status: 404, message: 'Not found' }),
  [standardRejections.notImplemented]: aCode({ origin: 'standard', status: 501, message: 'No' }),
};

const heading = {
  format: 1,
  kind: 'service',
  name: 'orders-service',
  standardRejections,
  defs: {},
  guards: {},
  codes: {},
  dependencies: {},
} as const;

function aProposed(fields: Partial<ServiceSnapshot> = {}): ServiceSnapshot {
  return { ...heading, endpoints: {}, events: {}, commands: {}, subscriptions: {}, ...fields };
}

function aBaseline(fields: Partial<PublishedServiceSnapshot> = {}): PublishedServiceSnapshot {
  return {
    ...heading,
    version: '3.4.0',
    generator: publishedBy,
    endpoints: {},
    events: {},
    commands: {},
    subscriptions: {},
    ...fields,
  };
}

function anApplication(): ApplicationSnapshot {
  return {
    format: 1,
    kind: 'application',
    name: 'web-app',
    dependencies: {},
  };
}

function aDefinitions(fields: Partial<DefinitionsSnapshot> = {}): DefinitionsSnapshot {
  return {
    format: 1,
    kind: 'definitions',
    name: '@org/definitions',
    standardRejections,
    defs: {},
    exports: schemaExports({}),
    guards: {},
    codes: {},
    ...fields,
  };
}

type Mismatch = {
  readonly name: string;
  readonly proposed: Snapshot;
  readonly baseline: PublishedSnapshot;
};

const mismatches: readonly Mismatch[] = [
  {
    name: 'a Service against a Baseline of another kind',
    proposed: aProposed(),
    baseline: {
      ...anApplication(),
      name: 'orders-service',
      version: '1.0.0',
      generator: publishedBy,
    },
  },
  {
    name: 'a Service against a Baseline of another name',
    proposed: aProposed(),
    baseline: aBaseline({ name: 'billing-service' }),
  },
  {
    name: 'an Application against a Baseline of another kind',
    proposed: anApplication(),
    baseline: aBaseline({ name: 'web-app' }),
  },
  {
    name: 'an Application against a Baseline of another name',
    proposed: anApplication(),
    baseline: { ...anApplication(), name: 'other-app', version: '1.0.0', generator: publishedBy },
  },
  {
    name: 'a Definitions Package against a Baseline of another kind',
    proposed: aDefinitions(),
    baseline: aBaseline({ name: '@org/definitions' }),
  },
  {
    name: 'a Definitions Package against a Baseline of another name',
    proposed: aDefinitions(),
    baseline: { ...aDefinitions(), name: '@org/other', version: '1.0.0', generator: publishedBy },
  },
];

describe('publishedSnapshotOf', () => {
  test('the published Snapshot carries the version given', () => {
    const published = publishedSnapshotOf(aBaseline(), aProposed(), publishedAt('3.5.0'));

    expect(published.version).toBe('3.5.0');
  });

  test('with no Baseline, an Element declared Retired is stamped retiredIn the version', () => {
    const proposed = aProposed({
      endpoints: { 'GET /orders/{}': anEndpoint({ lifecycle: 'retired' }) },
    });

    const published = publishedSnapshotOf(undefined, proposed, publishedAt('1.0.0'));

    expect(published.endpoints['GET /orders/{}']).toEqual(aRetired(anEndpoint(), '1.0.0'));
  });

  test('an Element newly Retired is stamped retiredIn the version', () => {
    const baseline = aBaseline({
      endpoints: { 'GET /orders/{}': aLive(anEndpoint(), 'deprecated') },
      events: { 'OrderPlaced@1': aLive(anEvent(), 'deprecated') },
      commands: { 'ChargeCard@1': aLive(aCommand(), 'deprecated') },
    });
    const proposed = aProposed({
      endpoints: { 'GET /orders/{}': anEndpoint({ lifecycle: 'retired' }) },
      events: { 'OrderPlaced@1': anEvent({ lifecycle: 'retired' }) },
      commands: { 'ChargeCard@1': aCommand({ lifecycle: 'retired' }) },
    });

    const published = publishedSnapshotOf(baseline, proposed, publishedAt('4.0.0'));

    expect([
      published.endpoints['GET /orders/{}'],
      published.events['OrderPlaced@1'],
      published.commands['ChargeCard@1'],
    ]).toEqual([
      aRetired(anEndpoint(), '4.0.0'),
      aRetired(anEvent(), '4.0.0'),
      aRetired(aCommand(), '4.0.0'),
    ]);
  });

  test('an Element Retired in the Baseline and still declared keeps its retiredIn', () => {
    const baseline = aBaseline({
      endpoints: { 'GET /orders/{}': aRetired(anEndpoint(), '3.0.0') },
    });
    const proposed = aProposed({
      endpoints: { 'GET /orders/{}': anEndpoint({ lifecycle: 'retired' }) },
    });

    const published = publishedSnapshotOf(baseline, proposed, publishedAt('3.5.0'));

    expect(published.endpoints['GET /orders/{}']).toEqual(aRetired(anEndpoint(), '3.0.0'));
  });

  test('a Retired Message Version whose declaration is deleted becomes a tombstone with the Baseline’s retiredIn and no Group', () => {
    const baseline = aBaseline({
      events: { 'OrderPlaced@1': aRetired(anEvent(), '3.0.0') },
      commands: { 'ChargeCard@1': aRetired(aCommand(), '3.1.0') },
    });

    const published = publishedSnapshotOf(baseline, aProposed(), publishedAt('3.5.0'));

    expect([published.events, published.commands]).toEqual([
      { 'OrderPlaced@1': { lifecycle: 'retired', retiredIn: '3.0.0' } },
      { 'ChargeCard@1': { lifecycle: 'retired', retiredIn: '3.1.0' } },
    ]);
  });

  test('an Endpoint’s tombstone keeps its name', () => {
    const baseline = aBaseline({
      endpoints: { 'GET /orders/{}': aRetired(anEndpoint(), '3.0.0') },
    });

    const published = publishedSnapshotOf(baseline, aProposed(), publishedAt('3.5.0'));

    expect(published.endpoints).toEqual({
      'GET /orders/{}': { lifecycle: 'retired', retiredIn: '3.0.0', name: 'getOrder' },
    });
  });

  test('the Baseline’s tombstones are carried forward', () => {
    const baseline = aBaseline({
      endpoints: {
        'GET /orders/{}': { lifecycle: 'retired', retiredIn: '2.0.0', name: 'getOrder' },
      },
      events: { 'OrderPlaced@1': { lifecycle: 'retired', retiredIn: '2.1.0' } },
      commands: { 'ChargeCard@1': { lifecycle: 'retired', retiredIn: '2.2.0' } },
    });

    const published = publishedSnapshotOf(baseline, aProposed(), publishedAt('3.5.0'));

    expect([published.endpoints, published.events, published.commands]).toEqual([
      baseline.endpoints,
      baseline.events,
      baseline.commands,
    ]);
  });

  test('a deleted Element not Retired in the Baseline is left out, since the check refuses it', () => {
    const baseline = aBaseline({ events: { 'OrderPlaced@1': aLive(anEvent()) } });

    const published = publishedSnapshotOf(baseline, aProposed(), publishedAt('3.5.0'));

    expect(published.events).toEqual({});
  });

  test('a Deprecated Endpoint is published with the deprecatedAt its declaration states, not the Baseline’s', () => {
    const baseline = aBaseline({
      endpoints: {
        'GET /orders/{}': aLive(anEndpoint({ deprecatedAt: '2026-10-17T09:30:00Z' }), 'deprecated'),
      },
    });
    const proposed = aProposed({
      endpoints: {
        'GET /orders/{}': anEndpoint({
          lifecycle: 'deprecated',
          deprecatedAt: '2026-10-20T10:00:00Z',
        }),
      },
    });

    const published = publishedSnapshotOf(baseline, proposed, publishedAt('3.5.0'));

    expect(published.endpoints['GET /orders/{}']).toEqual(
      anEndpoint({ lifecycle: 'deprecated', deprecatedAt: '2026-10-20T10:00:00Z' }),
    );
  });

  test('an Endpoint first Deprecated keeps its own deprecatedAt', () => {
    const baseline = aBaseline({ endpoints: { 'GET /orders/{}': aLive(anEndpoint()) } });
    const proposed = aProposed({
      endpoints: {
        'GET /orders/{}': anEndpoint({
          lifecycle: 'deprecated',
          deprecatedAt: '2026-10-20T10:00:00Z',
        }),
      },
    });

    const published = publishedSnapshotOf(baseline, proposed, publishedAt('3.5.0'));

    expect(published.endpoints['GET /orders/{}']).toEqual(
      anEndpoint({ lifecycle: 'deprecated', deprecatedAt: '2026-10-20T10:00:00Z' }),
    );
  });

  test.each(['active', 'retired'] as const)(
    'an Endpoint brought back to %s carries no deprecatedAt from the Baseline',
    (lifecycle) => {
      const baseline = aBaseline({
        endpoints: {
          'GET /orders/{}': aLive(
            anEndpoint({ deprecatedAt: '2026-10-17T09:30:00Z' }),
            'deprecated',
          ),
        },
      });
      const proposed = aProposed({ endpoints: { 'GET /orders/{}': anEndpoint({ lifecycle }) } });

      const published = publishedSnapshotOf(baseline, proposed, publishedAt('3.5.0'));

      expect(published.endpoints['GET /orders/{}']).not.toHaveProperty('deprecatedAt');
    },
  );

  test('a code no Endpoint answers any more stays, removed, with the status, body and message it last had', () => {
    const locked = aCode({
      status: 423,
      message: 'Locked',
      body: emptyObject,
      origin: '@org/definitions@4.2.0',
    });
    const baseline = aBaseline({ codes: { [orderLocked]: locked, [orderPaid]: aCode() } });
    const proposed = aProposed({ codes: { [orderPaid]: aCode() } });

    const published = publishedSnapshotOf(baseline, proposed, publishedAt('3.5.0'));

    expect(published.codes).toEqual({
      [orderLocked]: { ...locked, removed: true },
      [orderPaid]: aCode(),
    });
  });

  test('a code removed in the Baseline and answered again is the proposed one, not removed', () => {
    const baseline = aBaseline({ codes: { [orderLocked]: aCode({ status: 423, removed: true }) } });
    const proposed = aProposed({ codes: { [orderLocked]: aCode({ status: 423 }) } });

    const published = publishedSnapshotOf(baseline, proposed, publishedAt('3.5.0'));

    expect(published.codes).toEqual({ [orderLocked]: aCode({ status: 423 }) });
  });

  test('a removed Subscription becomes a tombstone with its Event and removedIn the version, and no description or Group', () => {
    const baseline = aBaseline({
      subscriptions: {
        legacySync: aSubscription('orders-service:OrderPlaced@1'),
        notifyOnSettled: aSubscription('payments-service:PaymentSettled@1'),
      },
    });
    const proposed = aProposed({
      subscriptions: { notifyOnSettled: aSubscription('payments-service:PaymentSettled@1') },
    });

    const published = publishedSnapshotOf(baseline, proposed, publishedAt('3.5.0'));

    expect(published.subscriptions).toEqual({
      legacySync: { event: 'orders-service:OrderPlaced@1', removedIn: '3.5.0' },
      notifyOnSettled: aSubscription('payments-service:PaymentSettled@1'),
    });
  });

  test('a Subscription tombstone of the Baseline is carried forward with its removedIn', () => {
    const tombstone = { event: 'orders-service:OrderPlaced@1', removedIn: '3.2.0' };
    const baseline = aBaseline({ subscriptions: { legacySync: tombstone } });

    const published = publishedSnapshotOf(baseline, aProposed(), publishedAt('3.5.0'));

    expect(published.subscriptions).toEqual({ legacySync: tombstone });
  });

  test('a Definitions Package’s removed codes are carried forward', () => {
    const baseline: PublishedDefinitionsSnapshot = {
      ...aDefinitions({ codes: { [oldCode]: aCode(), [keptCode]: aCode() } }),
      version: '4.2.0',
      generator: publishedBy,
    };
    const proposed = aDefinitions({ codes: { [keptCode]: aCode(), [newCode]: aCode() } });

    const published = publishedSnapshotOf(baseline, proposed, publishedAt('4.3.0'));

    expect(published).toEqual({
      ...proposed,
      version: '4.3.0',
      generator: publishedBy,
      codes: { [oldCode]: aCode({ removed: true }), [keptCode]: aCode(), [newCode]: aCode() },
    });
  });

  test('an Application’s published Snapshot is its declared one at the version', () => {
    const baseline: PublishedApplicationSnapshot = {
      ...anApplication(),
      version: '1.0.0',
      generator: publishedBy,
    };
    const proposed: ApplicationSnapshot = {
      ...anApplication(),
      dependencies: { 'orders-service': { against: '3.4.0', endpoints: [] } },
    };

    const published = publishedSnapshotOf(baseline, proposed, publishedAt('1.0.1'));

    expect(published).toEqual({ ...proposed, version: '1.0.1', generator: publishedBy });
  });

  test.each(mismatches)('$name is a bug, so the merge throws', ({ proposed, baseline }) => {
    expect(() => publishedSnapshotOf(baseline, proposed, publishedAt('3.5.0'))).toThrow(
      'is no Baseline of',
    );
  });

  test('what the merge writes decodes back to itself', () => {
    const baseline = aBaseline({
      endpoints: {
        'GET /orders/{}': aRetired(anEndpoint(), '3.0.0'),
        'DELETE /orders/{}': { lifecycle: 'retired', retiredIn: '2.0.0', name: 'cancelOrder' },
      },
      events: { 'OrderPlaced@1': aRetired(anEvent(), '3.1.0') },
      codes: { ...standardCodes, [orderLocked]: aCode() },
      subscriptions: { legacySync: aSubscription('orders-service:OrderPlaced@1') },
    });
    const proposed = aProposed({
      endpoints: { 'POST /orders': withoutParams(anEndpoint({ name: 'createOrder' })) },
      commands: { 'ChargeCard@1': aCommand({ lifecycle: 'retired' }) },
      codes: { ...standardCodes, [orderLocked]: aCode() },
    });

    const published = publishedSnapshotOf(baseline, proposed, publishedAt('3.5.0'));

    expect(decodeSnapshot(canonicalTextOf(published))).toEqual({
      kind: 'decoded',
      snapshot: published,
    });
  });

  test('merging an unchanged Snapshot into its Baseline hashes like the Baseline, whatever the version', () => {
    const deprecated = aLive(
      withoutParams(anEndpoint({ deprecatedAt: '2026-10-17T09:30:00Z' })),
      'deprecated',
    );
    const baseline = aBaseline({
      endpoints: {
        'GET /orders/{}': aRetired(anEndpoint(), '3.0.0'),
        'POST /orders': deprecated,
        'DELETE /orders/{}': { lifecycle: 'retired', retiredIn: '2.0.0', name: 'cancelOrder' },
      },
      codes: { [orderLocked]: aCode({ removed: true }) },
      subscriptions: { legacySync: { event: 'orders-service:OrderPlaced@1', removedIn: '3.2.0' } },
    });
    const proposed = aProposed({
      endpoints: {
        'GET /orders/{}': anEndpoint({ lifecycle: 'retired' }),
        'POST /orders': deprecated,
      },
    });

    const published = publishedSnapshotOf(baseline, proposed, publishedAt('9.9.9'));

    expect(hashedTextOf(published)).toBe(hashedTextOf(baseline));
  });
});

describe('publishedSnapshotOf, its types', () => {
  test('a Service’s Baseline and Snapshot merge into a published Service Snapshot', () => {
    const published = publishedSnapshotOf(aBaseline(), aProposed(), publishedAt('3.5.0'));

    expectTypeOf(published).toEqualTypeOf<PublishedServiceSnapshot>();
    expect(published.kind).toBe('service');
  });

  test('an Application’s and a Definitions Package’s merge by their own kind', () => {
    const application = publishedSnapshotOf(undefined, anApplication(), publishedAt('1.0.0'));
    const definitions = publishedSnapshotOf(undefined, aDefinitions(), publishedAt('1.0.0'));

    expectTypeOf(application).toEqualTypeOf<PublishedApplicationSnapshot>();
    expectTypeOf(definitions).toEqualTypeOf<PublishedDefinitionsSnapshot>();
    expect([application.kind, definitions.kind]).toEqual(['application', 'definitions']);
  });
});
