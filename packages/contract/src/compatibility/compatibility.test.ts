import { describe, expect, test } from 'vitest';
import {
  type ApplicationSnapshot,
  type Change,
  type ChangeSite,
  type CommandSnapshot,
  type CompatibilityReport,
  compatibilityReportOf,
  type DefinitionsSnapshot,
  type DependencyGraph,
  type DependencySnapshot,
  type EndpointSnapshot,
  type EventSnapshot,
  type GraphPackage,
  type PublishedApplicationSnapshot,
  type PublishedDefinitionsSnapshot,
  type PublishedServiceSnapshot,
  type PublishedSnapshot,
  type ServiceSnapshot,
  type Snapshot,
} from '../internal/index.ts';

type Lifecycle = EndpointSnapshot['lifecycle'];
type Visibility = EndpointSnapshot['visibility'];

const standardRejections: ServiceSnapshot['standardRejections'] = {
  invalidInput: { origin: 'standard', code: 'INVALID_INPUT', status: 400, message: 'Invalid' },
  notFound: { origin: 'standard', code: 'NOT_FOUND', status: 404, message: 'Not found' },
  notImplemented: { origin: 'standard', code: 'NOT_IMPLEMENTED', status: 501, message: 'No' },
};
const emptyObject = { type: 'object', mode: 'strict', fields: {} } as const;
const orderIdParam = {
  type: 'object',
  mode: 'strict',
  fields: { orderId: { required: true, schema: { type: 'string' } } },
} as const;
const heading = {
  format: 1,
  kind: 'service',
  name: 'orders-service',
  generator: '@cf-loom/cli@2.1.0',
  definitions: {},
  standardRejections,
  defs: {},
  guards: {},
  codes: {},
  dependencies: {},
} as const;

function anEndpoint(fields: Partial<EndpointSnapshot> = {}): EndpointSnapshot {
  return {
    name: 'getOrder',
    group: 'orders',
    visibility: 'public',
    lifecycle: 'active',
    description: 'One order',
    params: ['orderId'],
    guards: [],
    input: { params: orderIdParam, query: null, headers: null, body: null },
    success: { status: 200, headers: null, body: null },
    rejections: [],
    ...fields,
  };
}

function anEvent(fields: Partial<EventSnapshot> = {}): EventSnapshot {
  return {
    visibility: 'internal',
    lifecycle: 'active',
    description: 'An order was placed',
    body: emptyObject,
    ...fields,
  };
}

function aCommand(fields: Partial<CommandSnapshot> = {}): CommandSnapshot {
  return { lifecycle: 'active', description: 'Charge a card', body: emptyObject, ...fields };
}

function aLive<Element extends { readonly lifecycle: Lifecycle }>(
  element: Element,
  lifecycle: 'active' | 'deprecated' = 'active',
): Element & { readonly lifecycle: 'active' | 'deprecated' } {
  return { ...element, lifecycle };
}

function aRetired<Element extends { readonly lifecycle: Lifecycle }>(
  element: Element,
  retiredIn = '3.0.0',
): Element & { readonly lifecycle: 'retired'; readonly retiredIn: string } {
  return { ...element, lifecycle: 'retired', retiredIn };
}

function aProposed(fields: Partial<ServiceSnapshot> = {}): ServiceSnapshot {
  return { ...heading, endpoints: {}, events: {}, commands: {}, subscriptions: {}, ...fields };
}

function aBaseline(fields: Partial<PublishedServiceSnapshot> = {}): PublishedServiceSnapshot {
  return {
    ...heading,
    version: '3.4.0',
    endpoints: {},
    events: {},
    commands: {},
    subscriptions: {},
    ...fields,
  };
}

function anApplication(fields: Partial<ApplicationSnapshot> = {}): ApplicationSnapshot {
  return {
    format: 1,
    kind: 'application',
    name: 'web-app',
    generator: '@cf-loom/cli@2.1.0',
    dependencies: {},
    ...fields,
  };
}

function aDefinitions(fields: Partial<DefinitionsSnapshot> = {}): DefinitionsSnapshot {
  return {
    format: 1,
    kind: 'definitions',
    name: '@org/definitions',
    generator: '@cf-loom/cli@2.1.0',
    standardRejections,
    defs: {},
    schemas: {},
    guards: {},
    codes: {},
    ...fields,
  };
}

function aGraphPackage(fields: Partial<GraphPackage> = {}): GraphPackage {
  return {
    name: 'billing-service',
    version: '2.1.0',
    kind: 'service',
    dependencies: {},
    ...fields,
  };
}

function usingOrders(dependency: Partial<DependencySnapshot>): GraphPackage['dependencies'] {
  return { 'orders-service': { against: '3.4.0', endpoints: [], events: [], ...dependency } };
}

const getOrder = { id: 'GET /orders/{}', name: 'getOrder' };

function changesOf(
  baseline: PublishedSnapshot | undefined,
  proposed: Snapshot,
  graph: DependencyGraph = [],
): readonly Change[] {
  const report = compatibilityReportOf(baseline, proposed, graph);
  if (report.kind !== 'compared') {
    throw new Error('the Baseline was given, so the report must have compared');
  }
  return report.changes;
}

function identityOf(site: ChangeSite): string {
  return site.kind === 'shared-schema' ? site.name : site.identity;
}

type Element = {
  readonly name: string;
  readonly site: ChangeSite;
  readonly retiring: 'needed' | 'not-needed';
  readonly proposed: (lifecycle: Lifecycle) => Partial<ServiceSnapshot>;
  readonly live: (lifecycle: 'active' | 'deprecated') => Partial<PublishedServiceSnapshot>;
  readonly retired: () => Partial<PublishedServiceSnapshot>;
  readonly tombstone: () => Partial<PublishedServiceSnapshot>;
};

const endpoint: Element = {
  name: 'Endpoint',
  site: { kind: 'endpoint', identity: 'GET /orders/{}', visibility: 'public' },
  retiring: 'needed',
  proposed: (lifecycle) => ({ endpoints: { 'GET /orders/{}': anEndpoint({ lifecycle }) } }),
  live: (lifecycle) => ({ endpoints: { 'GET /orders/{}': aLive(anEndpoint(), lifecycle) } }),
  retired: () => ({ endpoints: { 'GET /orders/{}': aRetired(anEndpoint()) } }),
  tombstone: () => ({
    endpoints: { 'GET /orders/{}': { lifecycle: 'retired', retiredIn: '3.0.0', name: 'getOrder' } },
  }),
};
const event: Element = {
  name: 'Event',
  site: { kind: 'event', identity: 'OrderPlaced@1', visibility: 'internal' },
  retiring: 'not-needed',
  proposed: (lifecycle) => ({ events: { 'OrderPlaced@1': anEvent({ lifecycle }) } }),
  live: (lifecycle) => ({ events: { 'OrderPlaced@1': aLive(anEvent(), lifecycle) } }),
  retired: () => ({ events: { 'OrderPlaced@1': aRetired(anEvent()) } }),
  tombstone: () => ({ events: { 'OrderPlaced@1': { lifecycle: 'retired', retiredIn: '3.0.0' } } }),
};
const command: Element = {
  name: 'Command',
  site: { kind: 'command', identity: 'ChargeCard@1' },
  retiring: 'not-needed',
  proposed: (lifecycle) => ({ commands: { 'ChargeCard@1': aCommand({ lifecycle }) } }),
  live: (lifecycle) => ({ commands: { 'ChargeCard@1': aLive(aCommand(), lifecycle) } }),
  retired: () => ({ commands: { 'ChargeCard@1': aRetired(aCommand()) } }),
  tombstone: () => ({ commands: { 'ChargeCard@1': { lifecycle: 'retired', retiredIn: '3.0.0' } } }),
};
const elements = [endpoint, event, command];
const liveLifecycles = ['active', 'deprecated'] as const;
const eachLive = elements.flatMap((element) =>
  liveLifecycles.map((lifecycle) => ({ ...element, lifecycle })),
);

type Mismatch = {
  readonly name: string;
  readonly proposed: Snapshot;
  readonly baseline: PublishedSnapshot;
};

const mismatches: readonly Mismatch[] = [
  {
    name: 'a Service against a Baseline of another kind',
    proposed: aProposed(),
    baseline: { ...anApplication(), name: 'orders-service', version: '1.0.0' },
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
    baseline: { ...anApplication(), name: 'other-app', version: '1.0.0' },
  },
  {
    name: 'a Definitions Package against a Baseline of another kind',
    proposed: aDefinitions(),
    baseline: aBaseline({ name: '@org/definitions' }),
  },
  {
    name: 'a Definitions Package against a Baseline of another name',
    proposed: aDefinitions(),
    baseline: { ...aDefinitions(), name: '@org/other', version: '1.0.0' },
  },
];

describe('compatibilityReportOf, presence', () => {
  test('with no Baseline nothing is compared, so a first publish may start at any Message Version', () => {
    const proposed = aProposed({ events: { 'OrderPlaced@3': anEvent() } });

    const report = compatibilityReportOf(undefined, proposed, []);

    expect(report).toEqual({ kind: 'no-baseline' } satisfies CompatibilityReport);
  });

  test('a Snapshot identical to its Baseline has no Changes and an unchanged hash', () => {
    const baseline = aBaseline({ ...endpoint.live('active'), ...event.live('active') });
    const proposed = aProposed({ ...endpoint.proposed('active'), ...event.proposed('active') });

    const report = compatibilityReportOf(baseline, proposed, []);

    expect(report).toEqual({ kind: 'compared', changes: [], hashChanged: false });
  });

  test.each(elements)('adding a $name is Additive', ({ site, proposed }) => {
    const changes = changesOf(aBaseline(), aProposed(proposed('active')));

    expect(changes).toEqual([{ site, difference: { kind: 'added' }, class: 'additive' }]);
  });

  test.each(elements)(
    'deleting the declaration of a $name Retired in the Baseline is Neutral',
    ({ site, retired }) => {
      const changes = changesOf(aBaseline(retired()), aProposed());

      expect(changes).toEqual([{ site, difference: { kind: 'tombstoned' }, class: 'neutral' }]);
    },
  );

  test.each(eachLive)(
    'deleting a $name that is $lifecycle in the Baseline is not allowed',
    ({ site, live, lifecycle }) => {
      const changes = changesOf(aBaseline(live(lifecycle)), aProposed());

      expect(changes).toEqual([{ site, difference: { kind: 'deleted' }, class: 'not-allowed' }]);
    },
  );

  test.each(elements)(
    'a $name tombstone the proposed Snapshot no longer declares is no Change',
    ({ tombstone }) => {
      const report = compatibilityReportOf(aBaseline(tombstone()), aProposed(), []);

      expect(report).toEqual({ kind: 'compared', changes: [], hashChanged: false });
    },
  );

  test.each(elements)(
    'declaring a $name at a tombstone’s identity is not allowed: a Retired identity is never reused',
    ({ site, tombstone, proposed }) => {
      const changes = changesOf(aBaseline(tombstone()), aProposed(proposed('active')));

      expect(changes).toEqual([
        { site, difference: { kind: 'identity-reused' }, class: 'not-allowed' },
      ]);
    },
  );

  test('a new Message Version of a Retired one is Additive, not a reuse', () => {
    const baseline = aBaseline(event.tombstone());
    const proposed = aProposed({ events: { 'OrderPlaced@2': anEvent() } });

    const changes = changesOf(baseline, proposed);

    expect(changes).toEqual([
      {
        site: { kind: 'event', identity: 'OrderPlaced@2', visibility: 'internal' },
        difference: { kind: 'added' },
        class: 'additive',
      },
    ]);
  });

  test('moving an Endpoint’s path without retiring the old one is an added Endpoint and a deletion that is not allowed', () => {
    const baseline = aBaseline(endpoint.live('active'));
    const proposed = aProposed({
      endpoints: { 'GET /purchases/{}': anEndpoint({ params: ['purchaseId'] }) },
    });

    const changes = changesOf(baseline, proposed);

    expect(changes).toEqual([
      { site: endpoint.site, difference: { kind: 'deleted' }, class: 'not-allowed' },
      {
        site: { kind: 'endpoint', identity: 'GET /purchases/{}', visibility: 'public' },
        difference: { kind: 'added' },
        class: 'additive',
      },
    ]);
  });

  test('moving an Endpoint’s path while the old one stays declared Retired is an added Endpoint and a retirement', () => {
    const baseline = aBaseline(endpoint.live('deprecated'));
    const proposed = aProposed({
      endpoints: {
        'GET /orders/{}': anEndpoint({ lifecycle: 'retired' }),
        'GET /purchases/{}': anEndpoint({ params: ['purchaseId'] }),
      },
    });

    const changes = changesOf(baseline, proposed);

    expect(
      changes.map(({ site, difference, class: changeClass }) => [
        identityOf(site),
        difference.kind,
        changeClass,
      ]),
    ).toEqual([
      ['GET /orders/{}', 'retired', 'breaking'],
      ['GET /purchases/{}', 'added', 'additive'],
    ]);
  });
});

describe('compatibilityReportOf, lifecycle', () => {
  test.each(elements)('marking a $name Deprecated is Additive', ({ site, live, proposed }) => {
    const changes = changesOf(aBaseline(live('active')), aProposed(proposed('deprecated')));

    expect(changes).toEqual([{ site, difference: { kind: 'deprecated' }, class: 'additive' }]);
  });

  test.each(elements)(
    'bringing a Deprecated $name back to Active is Neutral',
    ({ site, live, proposed }) => {
      const changes = changesOf(aBaseline(live('deprecated')), aProposed(proposed('active')));

      expect(changes).toEqual([{ site, difference: { kind: 'reactivated' }, class: 'neutral' }]);
    },
  );

  test.each(elements)(
    'retiring a $name Deprecated in the Baseline is Breaking; its Approval is $retiring',
    ({ site, live, proposed, retiring }) => {
      const changes = changesOf(aBaseline(live('deprecated')), aProposed(proposed('retired')));

      expect(changes).toEqual([
        {
          site,
          difference: { kind: 'retired', dependencies: [] },
          class: 'breaking',
          approval: retiring,
        },
      ]);
    },
  );

  test.each(elements)(
    'retiring a $name Active in the Baseline is not allowed: it must be Deprecated first',
    ({ site, live, proposed }) => {
      const changes = changesOf(aBaseline(live('active')), aProposed(proposed('retired')));

      expect(changes).toEqual([
        { site, difference: { kind: 'retired-before-deprecated' }, class: 'not-allowed' },
      ]);
    },
  );

  test.each(elements)(
    'a $name added Retired gives an added and a retired-before-deprecated Change',
    ({ site, proposed }) => {
      const changes = changesOf(aBaseline(), aProposed(proposed('retired')));

      expect(changes).toEqual([
        { site, difference: { kind: 'added' }, class: 'additive' },
        { site, difference: { kind: 'retired-before-deprecated' }, class: 'not-allowed' },
      ]);
    },
  );

  test.each(eachLive)(
    'bringing a Retired $name back to $lifecycle is not allowed',
    ({ site, retired, proposed, lifecycle }) => {
      const changes = changesOf(aBaseline(retired()), aProposed(proposed(lifecycle)));

      expect(changes).toEqual([
        { site, difference: { kind: 'retired-brought-back', lifecycle }, class: 'not-allowed' },
      ]);
    },
  );

  test.each(elements)(
    'a $name Retired in the Baseline and still declared Retired is no Change',
    ({ retired, proposed }) => {
      const report = compatibilityReportOf(
        aBaseline(retired()),
        aProposed(proposed('retired')),
        [],
      );

      expect(report).toEqual({ kind: 'compared', changes: [], hashChanged: false });
    },
  );
});

describe('compatibilityReportOf, Dependencies', () => {
  test('retiring an Element lists every Dependency the graph holds on it, by package and version', () => {
    const graph: DependencyGraph = [
      aGraphPackage({
        name: 'web-app',
        version: '1.0.0',
        kind: 'application',
        dependencies: usingOrders({ endpoints: [getOrder] }),
      }),
      aGraphPackage({ version: '3.0.0', dependencies: usingOrders({ endpoints: [getOrder] }) }),
      aGraphPackage({ version: '2.1.0', dependencies: usingOrders({ endpoints: [getOrder] }) }),
      aGraphPackage({
        name: 'shipping-service',
        dependencies: usingOrders({ endpoints: [{ id: 'POST /orders', name: 'createOrder' }] }),
      }),
    ];

    const changes = changesOf(
      aBaseline(endpoint.live('deprecated')),
      aProposed(endpoint.proposed('retired')),
      graph,
    );

    expect(changes.map(({ difference }) => difference)).toEqual([
      {
        kind: 'retired',
        dependencies: [
          { name: 'billing-service', version: '2.1.0' },
          { name: 'billing-service', version: '3.0.0' },
          { name: 'web-app', version: '1.0.0' },
        ],
      },
    ]);
  });

  test('retiring an Event lists the Dependencies that subscribe to it', () => {
    const graph: DependencyGraph = [
      aGraphPackage({ dependencies: usingOrders({ events: ['OrderPlaced@1'] }) }),
      aGraphPackage({
        name: 'audit-service',
        dependencies: usingOrders({ events: ['OrderPlaced@2'] }),
      }),
    ];

    const changes = changesOf(
      aBaseline(event.live('deprecated')),
      aProposed(event.proposed('retired')),
      graph,
    );

    expect(changes.map(({ difference }) => difference)).toEqual([
      { kind: 'retired', dependencies: [{ name: 'billing-service', version: '2.1.0' }] },
    ]);
  });

  test('a Dependency on another Service’s Element with the same identity is not listed', () => {
    const graph: DependencyGraph = [
      aGraphPackage({
        dependencies: {
          'payments-service': { against: '1.0.0', endpoints: [getOrder], events: [] },
        },
      }),
    ];

    const changes = changesOf(
      aBaseline(endpoint.live('deprecated')),
      aProposed(endpoint.proposed('retired')),
      graph,
    );

    expect(changes.map(({ difference }) => difference)).toEqual([
      { kind: 'retired', dependencies: [] },
    ]);
  });
});

describe('compatibilityReportOf, Visibility', () => {
  function endpointVisible(visibility: Visibility, fields: Partial<EndpointSnapshot> = {}) {
    return { endpoints: { 'GET /orders/{}': anEndpoint({ visibility, ...fields }) } };
  }

  function publishedVisible(visibility: Visibility) {
    return { endpoints: { 'GET /orders/{}': aLive(anEndpoint({ visibility })) } };
  }

  test('widening an Element’s Visibility is Additive', () => {
    const changes = changesOf(
      aBaseline(publishedVisible('private')),
      aProposed(endpointVisible('public')),
    );

    expect(changes).toEqual([
      {
        site: { kind: 'endpoint', identity: 'GET /orders/{}', visibility: 'public' },
        difference: { kind: 'visibility-widened', from: 'private', to: 'public' },
        class: 'additive',
      },
    ]);
  });

  test('narrowing an Endpoint’s Visibility is Breaking and needs an Approval', () => {
    const changes = changesOf(
      aBaseline(publishedVisible('public')),
      aProposed(endpointVisible('internal')),
    );

    expect(changes).toEqual([
      {
        site: { kind: 'endpoint', identity: 'GET /orders/{}', visibility: 'public' },
        difference: { kind: 'visibility-narrowed', from: 'public', to: 'internal' },
        class: 'breaking',
        approval: 'needed',
      },
    ]);
  });

  test('narrowing an Event’s Visibility is Breaking and needs no Approval', () => {
    const baseline = aBaseline({
      events: { 'OrderPlaced@1': aLive(anEvent({ visibility: 'internal' })) },
    });
    const proposed = aProposed({ events: { 'OrderPlaced@1': anEvent({ visibility: 'private' }) } });

    const changes = changesOf(baseline, proposed);

    expect(changes).toEqual([
      {
        site: { kind: 'event', identity: 'OrderPlaced@1', visibility: 'internal' },
        difference: { kind: 'visibility-narrowed', from: 'internal', to: 'private' },
        class: 'breaking',
        approval: 'not-needed',
      },
    ]);
  });

  test('a Change on an Element whose Visibility moved carries the wider Visibility', () => {
    const baseline = aBaseline({
      events: { 'OrderPlaced@1': aLive(anEvent({ visibility: 'private' })) },
    });
    const proposed = aProposed({
      events: { 'OrderPlaced@1': anEvent({ visibility: 'internal', lifecycle: 'deprecated' }) },
    });

    const changes = changesOf(baseline, proposed);

    expect(changes.map(({ site }) => site)).toEqual([
      { kind: 'event', identity: 'OrderPlaced@1', visibility: 'internal' },
      { kind: 'event', identity: 'OrderPlaced@1', visibility: 'internal' },
    ]);
  });

  test('each difference on one Element is its own Change: Deprecated and narrowed together give two', () => {
    const baseline = aBaseline(publishedVisible('public'));
    const proposed = aProposed(endpointVisible('internal', { lifecycle: 'deprecated' }));

    const changes = changesOf(baseline, proposed);

    expect(changes.map(({ site, difference }) => [site, difference.kind])).toEqual([
      [{ kind: 'endpoint', identity: 'GET /orders/{}', visibility: 'public' }, 'deprecated'],
      [
        { kind: 'endpoint', identity: 'GET /orders/{}', visibility: 'public' },
        'visibility-narrowed',
      ],
    ]);
  });

  test('a Change on an Element on one side only carries that side’s Visibility', () => {
    const baseline = aBaseline({
      events: { 'OrderAudited@1': aLive(anEvent({ visibility: 'private' })) },
    });
    const proposed = aProposed({
      events: { 'OrderPlaced@1': anEvent({ visibility: 'internal' }) },
    });

    const changes = changesOf(baseline, proposed);

    expect(changes.map(({ site, difference }) => [site, difference.kind])).toEqual([
      [{ kind: 'event', identity: 'OrderAudited@1', visibility: 'private' }, 'deleted'],
      [{ kind: 'event', identity: 'OrderPlaced@1', visibility: 'internal' }, 'added'],
    ]);
  });
});

describe('compatibilityReportOf, renames', () => {
  function renamed(visibility: Visibility, proposedVisibility: Visibility = visibility) {
    const baseline = aBaseline({
      endpoints: { 'GET /orders/{}': aLive(anEndpoint({ visibility })) },
    });
    const proposed = aProposed({
      endpoints: {
        'GET /orders/{}': anEndpoint({ name: 'fetchOrder', visibility: proposedVisibility }),
      },
    });
    return { baseline, proposed };
  }

  test.each(['public', 'internal'] as const)(
    'renaming a %s Endpoint is Breaking, needs an Approval and lists every Dependency on it',
    (visibility) => {
      const { baseline, proposed } = renamed(visibility);
      const graph = [aGraphPackage({ dependencies: usingOrders({ endpoints: [getOrder] }) })];

      const changes = changesOf(baseline, proposed, graph);

      expect(changes).toEqual([
        {
          site: { kind: 'endpoint', identity: 'GET /orders/{}', visibility },
          difference: {
            kind: 'renamed',
            from: 'getOrder',
            to: 'fetchOrder',
            visibility,
            dependencies: [{ name: 'billing-service', version: '2.1.0' }],
          },
          class: 'breaking',
          approval: 'needed',
        },
      ]);
    },
  );

  test('renaming a Private Endpoint is Neutral', () => {
    const { baseline, proposed } = renamed('private');

    const changes = changesOf(baseline, proposed);

    expect(
      changes.map(({ difference, class: changeClass }) => [difference.kind, changeClass]),
    ).toEqual([['renamed', 'neutral']]);
  });

  test('renaming an Endpoint widened from Private in the same change is Neutral: no Consumer knew its name', () => {
    const { baseline, proposed } = renamed('private', 'public');

    const changes = changesOf(baseline, proposed);

    expect(
      changes.map(({ difference, class: changeClass }) => [difference.kind, changeClass]),
    ).toEqual([
      ['visibility-widened', 'additive'],
      ['renamed', 'neutral'],
    ]);
  });

  test('renaming an Endpoint narrowed to Private in the same change is Breaking', () => {
    const { baseline, proposed } = renamed('public', 'private');

    const changes = changesOf(baseline, proposed);

    expect(
      changes.map(({ difference, class: changeClass }) => [difference.kind, changeClass]),
    ).toEqual([
      ['visibility-narrowed', 'breaking'],
      ['renamed', 'breaking'],
    ]);
  });
});

describe('compatibilityReportOf, the report', () => {
  test('Changes are ordered by Endpoints, Events, then Commands, each by identity in code point order', () => {
    const proposed = aProposed({
      endpoints: { 'POST /orders': anEndpoint(), 'GET /orders/{}': anEndpoint() },
      events: { 'OrderPlaced@1': anEvent(), 'OrderCancelled@1': anEvent() },
      commands: { 'RefundCard@1': aCommand(), 'ChargeCard@1': aCommand() },
    });

    const changes = changesOf(aBaseline(), proposed);

    expect(changes.map(({ site }) => identityOf(site))).toEqual([
      'GET /orders/{}',
      'POST /orders',
      'OrderCancelled@1',
      'OrderPlaced@1',
      'ChargeCard@1',
      'RefundCard@1',
    ]);
  });

  test('an Application’s Dependencies give no Element Change, only a changed hash', () => {
    const baseline: PublishedApplicationSnapshot = { ...anApplication(), version: '1.0.0' };
    const proposed = anApplication({
      dependencies: { 'orders-service': { against: '3.4.0', endpoints: [getOrder], events: [] } },
    });

    const report = compatibilityReportOf(baseline, proposed, []);

    expect(report).toEqual({ kind: 'compared', changes: [], hashChanged: true });
  });

  test('a Definitions Package’s Snapshot gives no Element Change', () => {
    const baseline: PublishedDefinitionsSnapshot = { ...aDefinitions(), version: '4.2.0' };
    const proposed = aDefinitions({ defs: { money: emptyObject } });

    const report = compatibilityReportOf(baseline, proposed, []);

    expect(report).toEqual({ kind: 'compared', changes: [], hashChanged: true });
  });

  test('a Dependency declared against a newer version changes the hash', () => {
    const baseline = aBaseline({
      dependencies: { 'payments-service': { against: '5.1.0', endpoints: [], events: [] } },
    });
    const proposed = aProposed({
      dependencies: { 'payments-service': { against: '5.2.0', endpoints: [], events: [] } },
    });

    const report = compatibilityReportOf(baseline, proposed, []);

    expect(report).toEqual({ kind: 'compared', changes: [], hashChanged: true });
  });

  test.each(['3.4.0', '10.0.0-rc.1'])(
    'the hash of an unchanged Snapshot does not depend on the Baseline’s version, %s',
    (version) => {
      const baseline = aBaseline({
        version,
        endpoints: { 'GET /orders/{}': aRetired(anEndpoint(), '2.0.0') },
        events: { 'OrderPlaced@1': { lifecycle: 'retired', retiredIn: '2.1.0' } },
        subscriptions: {
          'legacy-sync': { event: 'orders-service:OrderPlaced@1', removedIn: '3.2.0' },
        },
      });
      const proposed = aProposed({
        endpoints: { 'GET /orders/{}': anEndpoint({ lifecycle: 'retired' }) },
      });

      const report = compatibilityReportOf(baseline, proposed, []);

      expect(report).toEqual({ kind: 'compared', changes: [], hashChanged: false });
    },
  );

  test('a new generator alone leaves the hash unchanged', () => {
    const baseline = aBaseline(endpoint.live('active'));
    const proposed = { ...aProposed(endpoint.proposed('active')), generator: '@cf-loom/cli@9.9.9' };

    const report = compatibilityReportOf(baseline, proposed, []);

    expect(report).toEqual({ kind: 'compared', changes: [], hashChanged: false });
  });

  test.each(mismatches)('$name is a bug, so the check throws', ({ proposed, baseline }) => {
    expect(() => compatibilityReportOf(baseline, proposed, [])).toThrow('is no Baseline of');
  });
});
