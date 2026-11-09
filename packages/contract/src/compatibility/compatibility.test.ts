import { describe, expect, test } from 'vitest';
import { codesNoEndpointAnswersBesideDefs } from '../../test/graft-shapes.ts';
import { orderOf, orders } from '../../test/growth.ts';
import { publishedAt, publishedBy, schemaExports } from '../../test/snapshots.ts';
import {
  type ApplicationSnapshot,
  type Change,
  type ChangeSite,
  type CommandSnapshot,
  compatibilityReportOf,
  type DefinitionsSnapshot,
  type Defs,
  type EndpointFields,
  type EndpointLifecycle,
  type EndpointSnapshot,
  type EventSnapshot,
  firstPublishChangesOf,
  type ObjectNode,
  type PublishedApplicationSnapshot,
  type PublishedDefinitionsSnapshot,
  type PublishedServiceSnapshot,
  type PublishedSnapshot,
  publishedSnapshotOf,
  type SchemaNode,
  type ServiceSnapshot,
  type Snapshot,
  type Verdict,
} from '../internal/index.ts';

type Lifecycle = EndpointSnapshot['lifecycle'];
type Visibility = EndpointSnapshot['visibility'];

const standardRejections: ServiceSnapshot['standardRejections'] = {
  invalidInput: 'INVALID_INPUT',
  notFound: 'NOT_FOUND',
  notImplemented: 'NOT_IMPLEMENTED',
};
const emptyObject: ObjectNode = { type: 'object', fields: {} };
const orderIdParam: ObjectNode = {
  type: 'object',
  fields: { orderId: { required: true, schema: { type: 'string' } } },
};
const heading = {
  format: 1,
  kind: 'service',
  name: 'orders-service',
  standardRejections,
  groups: {},
  defs: {},
  guards: {},
  codes: {},
  dependencies: {},
} as const;

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
      params: orderIdParam,
      query: emptyObject,
      headers: emptyObject,
      body: null,
    },
    success: { status: 200, headers: emptyObject, body: null },
    rejections: [],
    ...fields,
    ...(lifecycle ?? { lifecycle: 'active' }),
  };
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

/** An Endpoint's lifecycle as the Snapshot writes it, a Deprecated one with its instant. */
function endpointLifecycleOf(lifecycle: Lifecycle): EndpointLifecycle {
  return lifecycle === 'deprecated'
    ? { lifecycle, deprecatedAt: '2026-10-17T09:30:00Z' }
    : { lifecycle };
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
    generator: publishedBy,
    formerInputs: [],
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
    dependencies: {},
    ...fields,
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

const getOrder = { id: 'GET /orders/{}', name: 'getOrder' };

function changesOf(baseline: PublishedSnapshot, proposed: Snapshot): readonly Change[] {
  const report = compatibilityReportOf(baseline, proposed);
  return report.changes;
}

function identityOf(site: ChangeSite): string {
  switch (site.kind) {
    case 'code':
      return site.code;
    case 'guard':
    case 'group':
    case 'export':
    case 'subscription':
    case 'dependency':
    case 'standard-rejection':
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
  proposed: (lifecycle) => ({
    endpoints: { 'GET /orders/{}': anEndpoint({}, endpointLifecycleOf(lifecycle)) },
  }),
  live: (lifecycle) => ({
    endpoints: {
      'GET /orders/{}': aLive(anEndpoint({}, endpointLifecycleOf(lifecycle)), lifecycle),
    },
  }),
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

describe('compatibilityReportOf, presence', () => {
  test('with no Baseline only the numbering of Message Versions is judged, so a first publish starts at version 1', () => {
    const proposed = aProposed({ events: { 'OrderPlaced@3': anEvent() } });

    const changes = firstPublishChangesOf(proposed);

    expect(changes).toEqual([
      {
        site: { kind: 'event', identity: 'OrderPlaced@3', visibility: 'internal' },
        difference: { kind: 'version-gap', missing: 'OrderPlaced@2' },
        class: 'additive',
        verdict: 'refused',
      },
    ] satisfies Change[]);
  });

  test('a Snapshot identical to its Baseline has no Changes and an unchanged hash', () => {
    const baseline = aBaseline({ ...endpoint.live('active'), ...event.live('active') });
    const proposed = aProposed({ ...endpoint.proposed('active'), ...event.proposed('active') });

    const report = compatibilityReportOf(baseline, proposed);

    expect(report).toEqual({ changes: [] });
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
    'deleting a $name that is $lifecycle in the Baseline is refused',
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

      expect(report).toEqual({ changes: [] });
    },
  );

  test.each(elements)(
    'declaring a $name at a tombstone’s identity is refused: a Retired identity is never reused',
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

  test('moving an Endpoint’s path without retiring the old one is an added Endpoint and a deletion that is refused', () => {
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
        'GET /orders/{}': anEndpoint({}, { lifecycle: 'retired' }),
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
    'retiring a $name Active in the Baseline is refused: it must be Deprecated first',
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
    'bringing a Retired $name back to $lifecycle is refused',
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

      expect(report).toEqual({ changes: [] });
    },
  );
});

describe('compatibilityReportOf, Elements Retired on both sides', () => {
  const retiredEndpoint = aRetired(anEndpoint());
  const stillRetired = { lifecycle: 'retired' } as const;
  const requiredField = { required: true, schema: { type: 'string' } } as const;
  const changedBody = { type: 'object', fields: { id: requiredField } } as const;
  const rows = [
    {
      name: 'an Endpoint’s body',
      baseline: { endpoints: { 'GET /orders/{}': retiredEndpoint } },
      proposed: {
        endpoints: {
          'GET /orders/{}': anEndpoint(
            {
              success: { status: 200, headers: { type: 'object', fields: {} }, body: changedBody },
            },
            stillRetired,
          ),
        },
      },
    },
    {
      name: 'an Endpoint’s name',
      baseline: { endpoints: { 'GET /orders/{}': retiredEndpoint } },
      proposed: {
        endpoints: { 'GET /orders/{}': anEndpoint({ name: 'fetchOrder' }, stillRetired) },
      },
    },
    {
      name: 'an Endpoint’s Visibility',
      baseline: { endpoints: { 'GET /orders/{}': retiredEndpoint } },
      proposed: {
        endpoints: { 'GET /orders/{}': anEndpoint({ visibility: 'internal' }, stillRetired) },
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
    'an Element Retired on both sides gives one Neutral retired-changed when $name changes',
    ({ baseline, proposed }) => {
      const report = compatibilityReportOf(aBaseline(baseline), aProposed(proposed));

      expect(
        report.changes.map(({ difference, class: changeClass, verdict }) => [
          difference.kind,
          changeClass,
          verdict,
        ]),
      ).toEqual([['retired-changed', 'neutral', 'allowed']]);
    },
  );

  test('an Element retired in this change is judged by its lifecycle, and what it declares only as retired-changed', () => {
    const baseline = aBaseline(endpoint.live('deprecated'));
    const proposed = aProposed({
      endpoints: {
        'GET /orders/{}': anEndpoint(
          { success: { status: 201, headers: { type: 'object', fields: {} }, body: null } },
          { lifecycle: 'retired' },
        ),
      },
    });

    const changes = changesOf(baseline, proposed);

    expect(changes.map(({ difference }) => difference.kind)).toEqual([
      'retired',
      'retired-changed',
    ]);
  });
});

describe('compatibilityReportOf, the defs an Element Retired on both sides reaches', () => {
  /**
   * The sizes of `count` Commands over a chain of `count` defs: a check that reads the chain again
   * for each Command costs their product, so eight times as large costs about 64 times as much.
   */
  const sizes = { small: 64, large: 512 };

  const stillRetired = { lifecycle: 'retired' } as const;

  function aRef(name: string): SchemaNode {
    return { type: 'ref', name };
  }

  /** `count` objects `c0`, `c1`…, each holding the one before it by `next`, the first holding a string described `description`. */
  function aChainOf(count: number, description: string): Defs {
    const entries = Array.from({ length: count }, (_, index): [string, SchemaNode] => {
      const leaf: SchemaNode = { type: 'string', description };
      const next = index === 0 ? leaf : aRef(`c${index - 1}`);
      return [`c${index}`, { type: 'object', fields: { next: { required: true, schema: next } } }];
    });
    return Object.fromEntries(entries);
  }

  /** A body that holds the head of a chain of `count` defs in a field. */
  function bodyNamingHeadOf(count: number): SchemaNode {
    const at = { required: true, schema: aRef(`c${count - 1}`) };
    return { type: 'object', fields: { at } };
  }

  /** The check of the Commands that were Retired on both sides, against their Baseline, by the description at the end of the chain. */
  function checkOfCommands(proposedDescription: string) {
    return (count: number) => {
      const body = bodyNamingHeadOf(count);
      const identities = Array.from({ length: count }, (_, index) => `Retire${index}@1`);
      const baselineCommands = identities.map((identity) => [
        identity,
        aRetired(aCommand({ body })),
      ]);
      const proposedCommands = identities.map((identity) => [
        identity,
        aCommand({ ...stillRetired, body }),
      ]);
      const baseline = aBaseline({
        defs: aChainOf(count, 'a'),
        commands: Object.fromEntries(baselineCommands),
      });
      const proposed = aProposed({
        defs: aChainOf(count, proposedDescription),
        commands: Object.fromEntries(proposedCommands),
      });
      return () => compatibilityReportOf(baseline, proposed);
    };
  }

  test('many Commands Retired on both sides, whose bodies name the head of one unchanged chain of ids, are checked in time that grows with their number and the chain’s length', () => {
    const checkCommands = checkOfCommands('a');

    const report = checkCommands(sizes.large)();
    const order = orderOf(checkCommands, sizes, orders.linear);

    expect(report).toEqual({ changes: [] });
    expect(order).toBeLessThan(orders.linear);
  });

  test('a Command Retired on both sides whose body reaches a def that changed at the end of a chain gives one retired-changed', () => {
    const body = bodyNamingHeadOf(3);
    const baseline = aBaseline({
      defs: aChainOf(3, 'a'),
      commands: { 'ChargeCard@1': aRetired(aCommand({ body })) },
    });
    const proposed = aProposed({
      defs: aChainOf(3, 'b'),
      commands: { 'ChargeCard@1': aCommand({ ...stillRetired, body }) },
    });

    const report = compatibilityReportOf(baseline, proposed);

    expect(
      report.changes.map(({ difference, class: changeClass, verdict }) => [
        difference.kind,
        changeClass,
        verdict,
      ]),
    ).toEqual([['retired-changed', 'neutral', 'allowed']]);
  });
});

describe('publishedSnapshotOf, the codes no Endpoint answers any more', () => {
  const sizes = { small: 2_000, large: 16_000 };

  function mergeOfCodes(count: number) {
    const { baseline, proposed } = codesNoEndpointAnswersBesideDefs(count);
    return () => publishedSnapshotOf(baseline, proposed, publishedAt('1.1.0'));
  }

  test('many codes no Endpoint answers any more, beside many defs they do not reach, are merged in time that grows with both', () => {
    const published = mergeOfCodes(3)();
    const order = orderOf(mergeOfCodes, sizes, orders.linear);

    const removed = Object.entries(published.codes).filter(([, held]) => 'removedIn' in held);
    expect(removed.map(([code]) => code)).toEqual(['LOCKED_0', 'LOCKED_1', 'LOCKED_2']);
    expect(order).toBeLessThan(orders.linear);
  });
});

describe('compatibilityReportOf, Visibility', () => {
  function endpointVisible(visibility: Visibility, lifecycle?: EndpointLifecycle) {
    return { endpoints: { 'GET /orders/{}': anEndpoint({ visibility }, lifecycle) } };
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
    const proposed = aProposed(endpointVisible('internal', endpointLifecycleOf('deprecated')));

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

  test('an Application’s Dependencies give Dependency Changes, never Element Changes', () => {
    const baseline: PublishedApplicationSnapshot = {
      ...anApplication(),
      version: '1.0.0',
      generator: publishedBy,
    };
    const proposed = anApplication({
      dependencies: { 'orders-service': { against: '3.4.0', endpoints: [getOrder] } },
    });

    const report = compatibilityReportOf(baseline, proposed);

    expect(report.changes).toEqual([
      {
        site: { kind: 'dependency', name: 'orders-service', visibility: 'private' },
        difference: { kind: 'added' },
        class: 'neutral',
        verdict: 'allowed',
      },
    ]);
  });

  test('a Snapshot that differs where no rule looks is a bug, so the check throws', () => {
    const baseline: PublishedDefinitionsSnapshot = {
      ...aDefinitions(),
      version: '4.2.0',
      generator: publishedBy,
    };
    const proposed = aDefinitions({ defs: { money: emptyObject } });

    const check = () => compatibilityReportOf(baseline, proposed);

    expect(check).toThrow('The Snapshot changed but no Change was found: a bug.');
  });

  test('a Dependency declared against a newer version is one Neutral Change', () => {
    const baseline = aBaseline({
      dependencies: { 'payments-service': { against: '5.1.0', endpoints: [] } },
    });
    const proposed = aProposed({
      dependencies: { 'payments-service': { against: '5.2.0', endpoints: [] } },
    });

    const report = compatibilityReportOf(baseline, proposed);

    expect(report.changes.map(({ difference }) => difference)).toEqual([
      { kind: 'against-changed', from: '5.1.0', to: '5.2.0' },
    ]);
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
        endpoints: { 'GET /orders/{}': anEndpoint({}, { lifecycle: 'retired' }) },
      });

      const report = compatibilityReportOf(baseline, proposed);

      expect(report).toEqual({ changes: [] });
    },
  );

  test('a new generator alone leaves the hash unchanged', () => {
    const baseline = aBaseline(endpoint.live('active'));
    const proposed = { ...aProposed(endpoint.proposed('active')), generator: '@cf-loom/cli@9.9.9' };

    const report = compatibilityReportOf(baseline, proposed);

    expect(report).toEqual({ changes: [] });
  });

  test.each(mismatches)('$name is a bug, so the check throws', ({ proposed, baseline }) => {
    expect(() => compatibilityReportOf(baseline, proposed)).toThrow('is no Baseline of');
  });
});
