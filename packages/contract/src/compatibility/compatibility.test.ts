import { describe, expect, test } from 'vitest';
import {
  type ApplicationSnapshot,
  type Change,
  type ChangeSite,
  type CommandSnapshot,
  type CompatibilityReport,
  compatibilityReportOf,
  type DefinitionsSnapshot,
  type EndpointSnapshot,
  type EventSnapshot,
  type PublishedApplicationSnapshot,
  type PublishedDefinitionsSnapshot,
  type PublishedServiceSnapshot,
  type PublishedSnapshot,
  type ServiceSnapshot,
  type Snapshot,
  type Verdict,
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

const getOrder = { id: 'GET /orders/{}', name: 'getOrder' };

function changesOf(baseline: PublishedSnapshot | undefined, proposed: Snapshot): readonly Change[] {
  const report = compatibilityReportOf(baseline, proposed);
  if (report.kind !== 'compared') {
    throw new Error('the Baseline was given, so the report must have compared');
  }
  return report.changes;
}

function identityOf(site: ChangeSite): string {
  switch (site.kind) {
    case 'code':
      return site.code;
    case 'guard':
    case 'shared-schema':
    case 'subscription':
      return site.name;
    case 'endpoint':
    case 'event':
    case 'command':
      return site.identity;
  }
}

type Element = {
  readonly name: string;
  readonly site: ChangeSite;
  readonly retiring: Verdict;
  readonly proposed: (lifecycle: Lifecycle) => Partial<ServiceSnapshot>;
  readonly live: (lifecycle: 'active' | 'deprecated') => Partial<PublishedServiceSnapshot>;
  readonly retired: () => Partial<PublishedServiceSnapshot>;
  readonly tombstone: () => Partial<PublishedServiceSnapshot>;
};

const endpoint: Element = {
  name: 'Endpoint',
  site: { kind: 'endpoint', identity: 'GET /orders/{}', name: 'getOrder', visibility: 'public' },
  retiring: 'approval-needed',
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
  retiring: 'approval-needed',
  proposed: (lifecycle) => ({ events: { 'OrderPlaced@1': anEvent({ lifecycle }) } }),
  live: (lifecycle) => ({ events: { 'OrderPlaced@1': aLive(anEvent(), lifecycle) } }),
  retired: () => ({ events: { 'OrderPlaced@1': aRetired(anEvent()) } }),
  tombstone: () => ({ events: { 'OrderPlaced@1': { lifecycle: 'retired', retiredIn: '3.0.0' } } }),
};
const command: Element = {
  name: 'Command',
  site: { kind: 'command', identity: 'ChargeCard@1', visibility: 'private' },
  retiring: 'allowed',
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

    const report = compatibilityReportOf(undefined, proposed);

    expect(report).toEqual({ kind: 'no-baseline' } satisfies CompatibilityReport);
  });

  test('a Snapshot identical to its Baseline has no Changes and an unchanged hash', () => {
    const baseline = aBaseline({ ...endpoint.live('active'), ...event.live('active') });
    const proposed = aProposed({ ...endpoint.proposed('active'), ...event.proposed('active') });

    const report = compatibilityReportOf(baseline, proposed);

    expect(report).toEqual({ kind: 'compared', changes: [], hashChanged: false });
  });

  test.each(elements)('adding a $name is Additive', ({ site, proposed }) => {
    const changes = changesOf(aBaseline(), aProposed(proposed('active')));

    expect(changes).toEqual([
      { site, difference: { kind: 'added' }, class: 'additive', verdict: 'allowed' },
    ]);
  });

  test.each(elements)(
    'deleting the declaration of a $name Retired in the Baseline is Neutral',
    ({ site, retired }) => {
      const changes = changesOf(aBaseline(retired()), aProposed());

      expect(changes).toEqual([
        { site, difference: { kind: 'tombstoned' }, class: 'neutral', verdict: 'allowed' },
      ]);
    },
  );

  test.each(eachLive)(
    'deleting a $name that is $lifecycle in the Baseline is not allowed',
    ({ site, live, lifecycle }) => {
      const changes = changesOf(aBaseline(live(lifecycle)), aProposed());

      expect(changes).toEqual([
        { site, difference: { kind: 'deleted' }, class: 'breaking', verdict: 'refused' },
      ]);
    },
  );

  test('a Change on an Endpoint dropped from the proposed Snapshot names it as the Baseline did', () => {
    const baseline = aBaseline({
      endpoints: { 'GET /orders/{}': aLive(anEndpoint({ name: 'fetchOrder' })) },
    });

    const changes = changesOf(baseline, aProposed());

    expect(changes.map(({ site }) => site)).toEqual([
      { kind: 'endpoint', identity: 'GET /orders/{}', name: 'fetchOrder', visibility: 'public' },
    ]);
  });

  test.each(elements)(
    'a $name tombstone the proposed Snapshot no longer declares is no Change',
    ({ tombstone }) => {
      const report = compatibilityReportOf(aBaseline(tombstone()), aProposed());

      expect(report).toEqual({ kind: 'compared', changes: [], hashChanged: false });
    },
  );

  test.each(elements)(
    'declaring a $name at a tombstone’s identity is not allowed: a Retired identity is never reused',
    ({ site, tombstone, proposed }) => {
      const changes = changesOf(aBaseline(tombstone()), aProposed(proposed('active')));

      expect(changes).toEqual([
        { site, difference: { kind: 'identity-reused' }, class: 'breaking', verdict: 'refused' },
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
        verdict: 'allowed',
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
      {
        site: endpoint.site,
        difference: { kind: 'deleted' },
        class: 'breaking',
        verdict: 'refused',
      },
      {
        site: {
          kind: 'endpoint',
          identity: 'GET /purchases/{}',
          name: 'getOrder',
          visibility: 'public',
        },
        difference: { kind: 'added' },
        class: 'additive',
        verdict: 'allowed',
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

    expect(changes).toEqual([
      { site, difference: { kind: 'deprecated' }, class: 'additive', verdict: 'allowed' },
    ]);
  });

  test.each(elements)(
    'bringing a Deprecated $name back to Active is Neutral',
    ({ site, live, proposed }) => {
      const changes = changesOf(aBaseline(live('deprecated')), aProposed(proposed('active')));

      expect(changes).toEqual([
        { site, difference: { kind: 'reactivated' }, class: 'neutral', verdict: 'allowed' },
      ]);
    },
  );

  test.each(elements)(
    'retiring a $name Deprecated in the Baseline is Breaking; its Approval is $retiring',
    ({ site, live, proposed, retiring }) => {
      const changes = changesOf(aBaseline(live('deprecated')), aProposed(proposed('retired')));

      expect(changes).toEqual([
        { site, difference: { kind: 'retired' }, class: 'breaking', verdict: retiring },
      ]);
    },
  );

  test('retiring a Private Event Deprecated in the Baseline is Breaking and needs an Approval', () => {
    const baseline = aBaseline({
      events: { 'OrderAudited@1': aLive(anEvent({ visibility: 'private' }), 'deprecated') },
    });
    const proposed = aProposed({
      events: { 'OrderAudited@1': anEvent({ visibility: 'private', lifecycle: 'retired' }) },
    });

    const changes = changesOf(baseline, proposed);

    expect(changes).toEqual([
      {
        site: { kind: 'event', identity: 'OrderAudited@1', visibility: 'private' },
        difference: { kind: 'retired' },
        class: 'breaking',
        verdict: 'approval-needed',
      },
    ]);
  });

  test.each(elements)(
    'retiring a $name Active in the Baseline is not allowed: it must be Deprecated first',
    ({ site, live, proposed }) => {
      const changes = changesOf(aBaseline(live('active')), aProposed(proposed('retired')));

      expect(changes).toEqual([
        {
          site,
          difference: { kind: 'retired-before-deprecated' },
          class: 'breaking',
          verdict: 'refused',
        },
      ]);
    },
  );

  test.each(elements)(
    'a $name added Retired gives an added and a retired-before-deprecated Change',
    ({ site, proposed }) => {
      const changes = changesOf(aBaseline(), aProposed(proposed('retired')));

      expect(changes).toEqual([
        { site, difference: { kind: 'added' }, class: 'additive', verdict: 'allowed' },
        {
          site,
          difference: { kind: 'retired-before-deprecated' },
          class: 'breaking',
          verdict: 'refused',
        },
      ]);
    },
  );

  test.each(eachLive)(
    'bringing a Retired $name back to $lifecycle is not allowed',
    ({ site, retired, proposed, lifecycle }) => {
      const changes = changesOf(aBaseline(retired()), aProposed(proposed(lifecycle)));

      expect(changes).toEqual([
        {
          site,
          difference: { kind: 'retired-brought-back', lifecycle },
          class: 'additive',
          verdict: 'refused',
        },
      ]);
    },
  );

  test.each(elements)(
    'a $name Retired in the Baseline and still declared Retired is no Change',
    ({ retired, proposed }) => {
      const report = compatibilityReportOf(aBaseline(retired()), aProposed(proposed('retired')));

      expect(report).toEqual({ kind: 'compared', changes: [], hashChanged: false });
    },
  );
});

describe('compatibilityReportOf, Elements Retired on both sides', () => {
  const retiredEndpoint = aRetired(anEndpoint());
  const stillRetired = { lifecycle: 'retired' } as const;
  const requiredField = { required: true, schema: { type: 'string' } } as const;
  const changedBody = { type: 'object', mode: 'strict', fields: { id: requiredField } } as const;
  const rows = [
    {
      name: 'an Endpoint’s body',
      baseline: { endpoints: { 'GET /orders/{}': retiredEndpoint } },
      proposed: {
        endpoints: {
          'GET /orders/{}': anEndpoint({
            ...stillRetired,
            success: { status: 200, headers: null, body: changedBody },
          }),
        },
      },
    },
    {
      name: 'an Endpoint’s name',
      baseline: { endpoints: { 'GET /orders/{}': retiredEndpoint } },
      proposed: {
        endpoints: { 'GET /orders/{}': anEndpoint({ ...stillRetired, name: 'fetchOrder' }) },
      },
    },
    {
      name: 'an Endpoint’s Visibility',
      baseline: { endpoints: { 'GET /orders/{}': retiredEndpoint } },
      proposed: {
        endpoints: { 'GET /orders/{}': anEndpoint({ ...stillRetired, visibility: 'internal' }) },
      },
    },
    {
      name: 'an Event’s body',
      baseline: { events: { 'OrderPlaced@1': aRetired(anEvent()) } },
      proposed: {
        events: { 'OrderPlaced@1': anEvent({ ...stillRetired, body: changedBody }) },
      },
    },
    {
      name: 'an Event’s Visibility',
      baseline: { events: { 'OrderPlaced@1': aRetired(anEvent()) } },
      proposed: {
        events: { 'OrderPlaced@1': anEvent({ ...stillRetired, visibility: 'private' }) },
      },
    },
    {
      name: 'a Command’s body',
      baseline: { commands: { 'ChargeCard@1': aRetired(aCommand()) } },
      proposed: {
        commands: { 'ChargeCard@1': aCommand({ ...stillRetired, body: changedBody }) },
      },
    },
  ];

  test.each(rows)(
    'an Element Retired on both sides gives no Change when $name changes, only a changed hash',
    ({ baseline, proposed }) => {
      const report = compatibilityReportOf(aBaseline(baseline), aProposed(proposed));

      expect(report).toEqual({ kind: 'compared', changes: [], hashChanged: true });
    },
  );

  test('an Element retired in this change is still compared', () => {
    const baseline = aBaseline(endpoint.live('deprecated'));
    const proposed = aProposed({
      endpoints: {
        'GET /orders/{}': anEndpoint({
          lifecycle: 'retired',
          success: { status: 201, headers: null, body: null },
        }),
      },
    });

    const changes = changesOf(baseline, proposed);

    expect(changes.map(({ difference }) => difference.kind)).toEqual(['retired', 'status-changed']);
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
        site: { ...endpoint.site, visibility: 'public' },
        difference: { kind: 'visibility-widened', from: 'private', to: 'public' },
        class: 'additive',
        verdict: 'allowed',
      },
    ]);
  });

  test.each([
    { from: 'public', to: 'internal' },
    { from: 'internal', to: 'private' },
    { from: 'public', to: 'private' },
  ] as const)(
    'narrowing an Endpoint from $from to $to is Breaking and needs an Approval',
    ({ from, to }) => {
      const changes = changesOf(aBaseline(publishedVisible(from)), aProposed(endpointVisible(to)));

      expect(changes).toEqual([
        {
          site: { ...endpoint.site, visibility: from },
          difference: { kind: 'visibility-narrowed', from, to },
          class: 'breaking',
          verdict: 'approval-needed',
        },
      ]);
    },
  );

  test('narrowing an Event’s Visibility is Breaking and needs an Approval', () => {
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
        verdict: 'approval-needed',
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
      [{ ...endpoint.site, visibility: 'public' }, 'deprecated'],
      [{ ...endpoint.site, visibility: 'public' }, 'visibility-narrowed'],
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
    'renaming a %s Endpoint is Breaking and needs an Approval',
    (visibility) => {
      const { baseline, proposed } = renamed(visibility);

      const changes = changesOf(baseline, proposed);

      expect(changes).toEqual([
        {
          site: { ...endpoint.site, name: 'fetchOrder', visibility },
          difference: {
            kind: 'renamed',
            from: 'getOrder',
            to: 'fetchOrder',
            baselineVisibility: visibility,
          },
          class: 'breaking',
          verdict: 'approval-needed',
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

    const report = compatibilityReportOf(baseline, proposed);

    expect(report).toEqual({ kind: 'compared', changes: [], hashChanged: true });
  });

  test('a Definitions Package’s Snapshot gives no Element Change', () => {
    const baseline: PublishedDefinitionsSnapshot = { ...aDefinitions(), version: '4.2.0' };
    const proposed = aDefinitions({ defs: { money: emptyObject } });

    const report = compatibilityReportOf(baseline, proposed);

    expect(report).toEqual({ kind: 'compared', changes: [], hashChanged: true });
  });

  test('a Dependency declared against a newer version changes the hash', () => {
    const baseline = aBaseline({
      dependencies: { 'payments-service': { against: '5.1.0', endpoints: [], events: [] } },
    });
    const proposed = aProposed({
      dependencies: { 'payments-service': { against: '5.2.0', endpoints: [], events: [] } },
    });

    const report = compatibilityReportOf(baseline, proposed);

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
          legacySync: { event: 'orders-service:OrderPlaced@1', removedIn: '3.2.0' },
        },
      });
      const proposed = aProposed({
        endpoints: { 'GET /orders/{}': anEndpoint({ lifecycle: 'retired' }) },
      });

      const report = compatibilityReportOf(baseline, proposed);

      expect(report).toEqual({ kind: 'compared', changes: [], hashChanged: false });
    },
  );

  test('a new generator alone leaves the hash unchanged', () => {
    const baseline = aBaseline(endpoint.live('active'));
    const proposed = { ...aProposed(endpoint.proposed('active')), generator: '@cf-loom/cli@9.9.9' };

    const report = compatibilityReportOf(baseline, proposed);

    expect(report).toEqual({ kind: 'compared', changes: [], hashChanged: false });
  });

  test.each(mismatches)('$name is a bug, so the check throws', ({ proposed, baseline }) => {
    expect(() => compatibilityReportOf(baseline, proposed)).toThrow('is no Baseline of');
  });
});
