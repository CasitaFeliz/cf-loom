import { describe, expect, expectTypeOf, test } from 'vitest';
import { seededNext } from '../../test/random-schemas.ts';
import { publishedAt, publishedBy, schemaExports } from '../../test/snapshots.ts';
import {
  type ApplicationSnapshot,
  type CodeSnapshot,
  type CommandSnapshot,
  canonicalTextOf,
  type DefinitionsSnapshot,
  decodeSnapshot,
  defScopesOf,
  type EndpointFields,
  type EndpointLifecycle,
  type EndpointSnapshot,
  type EventSnapshot,
  hashedTextOf,
  isRemoved,
  nodeNestingLimit,
  type PublishedApplicationSnapshot,
  type PublishedCode,
  type PublishedDefinitionsSnapshot,
  type PublishedServiceSnapshot,
  type PublishedSnapshot,
  publishedSnapshotOf,
  type RemovedCode,
  type SchemaNode,
  type ServiceSnapshot,
  type Snapshot,
  type SubscriptionSnapshot,
  snapshotNestingLimit,
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

function anEndpoint<const Lifecycle extends EndpointLifecycle = { readonly lifecycle: 'active' }>(
  fields: Partial<EndpointFields> = {},
  lifecycle?: Lifecycle,
): EndpointFields & (Lifecycle | { readonly lifecycle: 'active' }) {
  return {
    name: 'getOrder',
    group: 'orders',
    visibility: 'public',
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
    ...(lifecycle ?? { lifecycle: 'active' }),
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

function aCode(fields: Partial<PublishedCode> = {}): PublishedCode {
  return {
    origin: 'local',
    status: 409,
    message: 'The order can no longer be changed',
    headers: { type: 'object', fields: {} },
    body: null,
    ...fields,
  };
}

function aRemovedCode(fields: Partial<RemovedCode> = {}): RemovedCode {
  return { ...aCode(), removedIn: '3.2.0', defs: {}, ...fields };
}

const ref = (name: string): SchemaNode => ({ type: 'ref', name });

/** A body whose only field leads to the def `name`. */
function reaching(name: string): SchemaNode {
  return { type: 'object', fields: { [name]: { required: true, schema: ref(name) } } };
}

/** A recursive def, with a `label` field when it declares one. */
function aTree(fields: { readonly label: boolean }): SchemaNode {
  const label = { required: true, schema: { type: 'string' } } as const;
  const children = { required: true, schema: { type: 'array', items: ref('tree') } } as const;
  return { type: 'object', fields: fields.label ? { children, label } : { children } };
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
  groups: { orders: { description: 'Orders' } },
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
    formerInputs: [],
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

const generatedCodes = ['ALPHA', 'BRAVO', 'CHARLIE'] as const;

/** What a generated code may reach: nothing, `tree`, or `kin`, which leads on to `tree`. */
const generatedReach = [
  { body: null, defs: [] },
  { body: reaching('tree'), defs: ['tree'] },
  { body: reaching('kin'), defs: ['kin', 'tree'] },
] as const;

/** The defs a generated Snapshot may hold, each in a shape the draw picks. */
function generatedDefs(next: () => number): Readonly<Record<string, SchemaNode>> {
  const note = { required: true, schema: { type: 'string' } } as const;
  const kin: SchemaNode = {
    type: 'object',
    fields: { tree: { required: true, schema: ref('tree') }, ...(next() < 0.5 ? { note } : {}) },
  };
  return { kin, tree: aTree({ label: next() < 0.5 }) };
}

/** A declared Service Snapshot drawn at random: each generated code declared or not, reaching what it draws, and answered by its one Endpoint. */
function aGeneratedProposed(next: () => number): ServiceSnapshot {
  const drawn = generatedDefs(next);
  const codes: Record<string, CodeSnapshot> = { ...standardCodes };
  const answered: string[] = [];
  const reached = new Set<string>();
  for (const code of generatedCodes) {
    const reach = generatedReach[Math.floor(next() * (generatedReach.length + 1))];
    if (reach !== undefined) {
      codes[code] = aCode({ body: reach.body });
      answered.push(code);
      for (const name of reach.defs) {
        reached.add(name);
      }
    }
  }
  const defs = Object.entries(drawn).filter(([name]) => reached.has(name));
  const endpoint = withoutParams(anEndpoint({ name: 'createOrder', rejections: answered }));
  return aProposed({
    defs: Object.fromEntries(defs),
    codes,
    endpoints: { 'POST /orders': endpoint },
  });
}

/** How many keys below the outermost object the root of each schema node of a Snapshot sits. */
function rootDepthsOf(snapshot: ServiceSnapshot | PublishedServiceSnapshot): readonly number[] {
  return defScopesOf(snapshot).flatMap(({ nodes }) => nodes.map(({ at }) => at.length));
}

type Step = {
  readonly baseline: PublishedServiceSnapshot | undefined;
  readonly proposed: ServiceSnapshot;
  readonly published: PublishedServiceSnapshot;
};

/** Seeded publishes of generated Snapshots one after another, each against the one before. */
function histories(): readonly (readonly [number, readonly Step[]])[] {
  return Array.from({ length: 200 }, (_, seed) => {
    const next = seededNext(seed + 1);
    const steps: Step[] = [];
    let baseline: PublishedServiceSnapshot | undefined;
    for (let version = 0; version < 6; version++) {
      const proposed = aGeneratedProposed(next);
      const published = publishedSnapshotOf(baseline, proposed, publishedAt(`3.${version}.0`));
      steps.push({ baseline, proposed, published });
      baseline = published;
    }
    return [seed, steps] as const;
  });
}

describe('publishedSnapshotOf', () => {
  test('the published Snapshot carries the version given', () => {
    const published = publishedSnapshotOf(aBaseline(), aProposed(), publishedAt('3.5.0'));

    expect(published.version).toBe('3.5.0');
  });

  test('with no Baseline, an Element declared Retired is stamped retiredIn the version', () => {
    const proposed = aProposed({
      endpoints: { 'GET /orders/{}': anEndpoint({}, { lifecycle: 'retired' }) },
    });

    const published = publishedSnapshotOf(undefined, proposed, publishedAt('1.0.0'));

    expect(published.endpoints['GET /orders/{}']).toEqual(aRetired(anEndpoint(), '1.0.0'));
  });

  test('an Element newly Retired is stamped retiredIn the version', () => {
    const baseline = aBaseline({
      endpoints: {
        'GET /orders/{}': aLive(
          anEndpoint({}, { lifecycle: 'deprecated', deprecatedAt: '2026-10-17T09:30:00Z' }),
          'deprecated',
        ),
      },
      events: { 'OrderPlaced@1': aLive(anEvent(), 'deprecated') },
      commands: { 'ChargeCard@1': aLive(aCommand(), 'deprecated') },
    });
    const proposed = aProposed({
      endpoints: { 'GET /orders/{}': anEndpoint({}, { lifecycle: 'retired' }) },
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
      endpoints: { 'GET /orders/{}': anEndpoint({}, { lifecycle: 'retired' }) },
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
        'GET /orders/{}': aLive(
          anEndpoint({}, { lifecycle: 'deprecated', deprecatedAt: '2026-10-17T09:30:00Z' }),
          'deprecated',
        ),
      },
    });
    const proposed = aProposed({
      endpoints: {
        'GET /orders/{}': anEndpoint(
          {},
          { lifecycle: 'deprecated', deprecatedAt: '2026-10-20T10:00:00Z' },
        ),
      },
    });

    const published = publishedSnapshotOf(baseline, proposed, publishedAt('3.5.0'));

    expect(published.endpoints['GET /orders/{}']).toEqual(
      anEndpoint({}, { lifecycle: 'deprecated', deprecatedAt: '2026-10-20T10:00:00Z' }),
    );
  });

  test('an Endpoint first Deprecated keeps its own deprecatedAt', () => {
    const baseline = aBaseline({ endpoints: { 'GET /orders/{}': aLive(anEndpoint()) } });
    const proposed = aProposed({
      endpoints: {
        'GET /orders/{}': anEndpoint(
          {},
          { lifecycle: 'deprecated', deprecatedAt: '2026-10-20T10:00:00Z' },
        ),
      },
    });

    const published = publishedSnapshotOf(baseline, proposed, publishedAt('3.5.0'));

    expect(published.endpoints['GET /orders/{}']).toEqual(
      anEndpoint({}, { lifecycle: 'deprecated', deprecatedAt: '2026-10-20T10:00:00Z' }),
    );
  });

  test.each([
    ['active', anEndpoint()],
    ['retired', aRetired(anEndpoint(), '3.5.0')],
  ] as const)(
    'an Endpoint brought back to %s is its proposed self, with no deprecatedAt from the Baseline',
    (lifecycle, expected) => {
      const baseline = aBaseline({
        endpoints: {
          'GET /orders/{}': aLive(
            anEndpoint({}, { lifecycle: 'deprecated', deprecatedAt: '2026-10-17T09:30:00Z' }),
            'deprecated',
          ),
        },
      });
      const proposed = aProposed({
        endpoints: { 'GET /orders/{}': anEndpoint({}, { lifecycle }) },
      });

      const published = publishedSnapshotOf(baseline, proposed, publishedAt('3.5.0'));

      expect(published.endpoints['GET /orders/{}']).toStrictEqual(expected);
    },
  );

  test('a code no Endpoint answers any more stays, with the status, headers, body and message it last had, and removedIn the version', () => {
    const locked = aCode({
      status: 423,
      message: 'Locked',
      headers: {
        type: 'object',
        fields: { 'retry-after': { required: true, schema: { type: 'number', int: true } } },
      },
      body: emptyObject,
      origin: '@org/definitions@4.2.0',
    });
    const baseline = aBaseline({ codes: { [orderLocked]: locked, [orderPaid]: aCode() } });
    const proposed = aProposed({ codes: { [orderPaid]: aCode() } });

    const published = publishedSnapshotOf(baseline, proposed, publishedAt('3.5.0'));

    expect(published.codes).toEqual({
      [orderLocked]: { ...locked, removedIn: '3.5.0', defs: {} },
      [orderPaid]: aCode(),
    });
  });

  test('a code removed in the Baseline stays removed in the version that first left it out, whatever the later publishes', () => {
    const baseline = aBaseline({ codes: { [orderLocked]: aRemovedCode({ removedIn: '3.2.0' }) } });

    const published = publishedSnapshotOf(baseline, aProposed(), publishedAt('3.5.0'));

    expect(published.codes).toEqual({ [orderLocked]: aRemovedCode({ removedIn: '3.2.0' }) });
  });

  test('a code removed in the Baseline and answered again is the proposed one, with no removedIn', () => {
    const baseline = aBaseline({
      codes: { [orderLocked]: aRemovedCode({ status: 423, removedIn: '3.2.0' }) },
    });
    const proposed = aProposed({ codes: { [orderLocked]: aCode({ status: 423 }) } });

    const published = publishedSnapshotOf(baseline, proposed, publishedAt('3.5.0'));

    expect(published.codes).toEqual({ [orderLocked]: aCode({ status: 423 }) });
  });

  test('a code removed now keeps the defs its body reaches, through other defs, as the Baseline held them', () => {
    const leaf: SchemaNode = { type: 'object', fields: {} };
    const tree: SchemaNode = {
      type: 'object',
      fields: {
        leaf: { required: true, schema: ref('leaf') },
        again: { required: true, schema: ref('tree') },
      },
    };
    const baseline = aBaseline({
      defs: { leaf, other: leaf, tree },
      codes: { [orderLocked]: aCode({ body: reaching('tree') }), [orderPaid]: aCode() },
    });
    const proposed = aProposed({ defs: { other: leaf }, codes: { [orderPaid]: aCode() } });

    const published = publishedSnapshotOf(baseline, proposed, publishedAt('3.5.0'));

    expect(published.codes[orderLocked]).toEqual(
      aRemovedCode({ body: reaching('tree'), removedIn: '3.5.0', defs: { leaf, tree } }),
    );
  });

  test('a code removed now that reaches no def keeps empty defs', () => {
    const baseline = aBaseline({
      defs: { tree: aTree({ label: true }) },
      codes: { [orderLocked]: aCode(), [orderPaid]: aCode({ body: reaching('tree') }) },
    });
    const proposed = aProposed({
      defs: { tree: aTree({ label: true }) },
      codes: { [orderPaid]: aCode({ body: reaching('tree') }) },
    });

    const published = publishedSnapshotOf(baseline, proposed, publishedAt('3.5.0'));

    expect(published.codes[orderLocked]).toEqual(aRemovedCode({ removedIn: '3.5.0', defs: {} }));
  });

  test('a removed code keeps its own defs when the proposed Snapshot changes a def of the same name', () => {
    const body = reaching('tree');
    const baseline = aBaseline({
      defs: { tree: aTree({ label: true }) },
      codes: { [orderLocked]: aCode({ body }), [orderPaid]: aCode({ body }) },
    });
    const proposed = aProposed({
      defs: { tree: aTree({ label: false }) },
      codes: { [orderPaid]: aCode({ body }) },
    });

    const published = publishedSnapshotOf(baseline, proposed, publishedAt('3.5.0'));

    expect(published.codes[orderLocked]).toEqual(
      aRemovedCode({ body, removedIn: '3.5.0', defs: { tree: aTree({ label: true }) } }),
    );
  });

  test('a removed code keeps its own defs when the proposed Snapshot drops that def', () => {
    const body = reaching('tree');
    const baseline = aBaseline({
      defs: { tree: aTree({ label: true }) },
      codes: { [orderLocked]: aCode({ body }), [orderPaid]: aCode() },
    });
    const proposed = aProposed({ codes: { [orderPaid]: aCode() } });

    const published = publishedSnapshotOf(baseline, proposed, publishedAt('3.5.0'));

    expect(published.codes[orderLocked]).toEqual(
      aRemovedCode({ body, removedIn: '3.5.0', defs: { tree: aTree({ label: true }) } }),
    );
  });

  test('the Snapshot’s defs are the proposed Snapshot’s, whatever its removed codes reach', () => {
    const body = reaching('tree');
    const baseline = aBaseline({
      defs: { tree: aTree({ label: true }) },
      codes: {
        [orderLocked]: aCode({ body }),
        [orderPaid]: aCode({ body }),
        [oldCode]: aCode({ body }),
      },
    });
    const proposed = aProposed({
      defs: { tree: aTree({ label: false }) },
      codes: { [orderPaid]: aCode({ body }) },
    });
    const dropping = aProposed({ codes: {} });

    const changed = publishedSnapshotOf(baseline, proposed, publishedAt('3.5.0'));
    const dropped = publishedSnapshotOf(baseline, dropping, publishedAt('3.5.0'));

    expect(changed.defs).toEqual({ tree: aTree({ label: false }) });
    expect(dropped.defs).toEqual({});
  });

  test('a removed code answered again is published as declared, with no removedIn or defs', () => {
    const body = reaching('tree');
    const baseline = aBaseline({
      codes: {
        [orderLocked]: aRemovedCode({ body, defs: { tree: aTree({ label: true }) } }),
      },
    });
    const proposed = aProposed({
      defs: { tree: aTree({ label: false }) },
      codes: { [orderLocked]: aCode({ body }) },
    });

    const published = publishedSnapshotOf(baseline, proposed, publishedAt('3.5.0'));

    expect(published.codes[orderLocked]).toEqual(aCode({ body }));
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
      codes: {
        [oldCode]: aRemovedCode({ removedIn: '4.3.0' }),
        [keptCode]: aCode(),
        [newCode]: aCode(),
      },
    });
  });

  test('a Definitions Package’s removed code keeps the defs it reached', () => {
    const body = reaching('tree');
    const baseline: PublishedDefinitionsSnapshot = {
      ...aDefinitions({
        defs: { tree: aTree({ label: true }) },
        codes: { [oldCode]: aCode({ body }), [keptCode]: aCode({ body }) },
      }),
      version: '4.2.0',
      generator: publishedBy,
    };
    const proposed = aDefinitions({
      defs: { tree: aTree({ label: false }) },
      codes: { [keptCode]: aCode({ body }) },
    });

    const published = publishedSnapshotOf(baseline, proposed, publishedAt('4.3.0'));

    expect(published.codes[oldCode]).toEqual(
      aRemovedCode({ body, removedIn: '4.3.0', defs: { tree: aTree({ label: true }) } }),
    );
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
      endpoints: {
        'POST /orders': withoutParams(
          anEndpoint({ name: 'createOrder', rejections: [orderLocked] }),
        ),
      },
      commands: { 'ChargeCard@1': aCommand({ lifecycle: 'retired' }) },
      codes: { ...standardCodes, [orderLocked]: aCode() },
    });

    const published = publishedSnapshotOf(baseline, proposed, publishedAt('3.5.0'));

    expect(decodeSnapshot(canonicalTextOf(published))).toEqual({
      kind: 'decoded',
      snapshot: published,
    });
  });

  test('what the merge writes decodes back to itself, for any history', () => {
    for (const [seed, steps] of histories()) {
      for (const { published } of steps) {
        const decoded = decodeSnapshot(canonicalTextOf(published));

        expect(decoded, `seed ${seed}`).toEqual({ kind: 'decoded', snapshot: published });
      }
    }
  });

  test('a removed code never changes after the publish that removed it, for any history', () => {
    for (const [seed, steps] of histories()) {
      for (const { baseline, proposed, published } of steps) {
        const held = Object.entries(baseline?.codes ?? {}).filter(
          ([code]) => !(code in proposed.codes),
        );
        for (const [code, was] of held.filter(([, removed]) => isRemoved(removed))) {
          expect(published.codes[code], `seed ${seed}, ${code}`).toEqual(was);
        }
      }
    }
  });

  test('no schema node of a Snapshot sits deeper than a node of the nesting limit leaves room for, for any history', () => {
    const keys = snapshotNestingLimit - nodeNestingLimit;
    for (const [seed, steps] of histories()) {
      const depths = steps.flatMap(({ proposed, published }) => [
        ...rootDepthsOf(proposed),
        ...rootDepthsOf(published),
      ]);

      expect(Math.max(...depths), `seed ${seed}`).toBeLessThanOrEqual(keys);
    }
  });

  test('merging an unchanged Snapshot into its Baseline hashes like the Baseline, whatever the version', () => {
    const deprecated = aLive(
      withoutParams(
        anEndpoint({}, { lifecycle: 'deprecated', deprecatedAt: '2026-10-17T09:30:00Z' }),
      ),
      'deprecated',
    );
    const baseline = aBaseline({
      endpoints: {
        'GET /orders/{}': aRetired(anEndpoint(), '3.0.0'),
        'POST /orders': deprecated,
        'DELETE /orders/{}': { lifecycle: 'retired', retiredIn: '2.0.0', name: 'cancelOrder' },
      },
      codes: {
        [orderLocked]: aRemovedCode({
          removedIn: '3.2.0',
          body: reaching('tree'),
          defs: { tree: aTree({ label: true }) },
        }),
      },
      subscriptions: { legacySync: { event: 'orders-service:OrderPlaced@1', removedIn: '3.2.0' } },
    });
    const proposed = aProposed({
      endpoints: {
        'GET /orders/{}': anEndpoint({}, { lifecycle: 'retired' }),
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
