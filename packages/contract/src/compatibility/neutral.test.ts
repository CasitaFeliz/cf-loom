import { describe, expect, test } from 'vitest';
import { publishedBy, schemaExports } from '../../test/snapshots.ts';
import {
  type Change,
  type ChangeSite,
  type CodeSnapshot,
  type CommandSnapshot,
  compatibilityReportOf,
  type DefinitionsSnapshot,
  type Difference,
  type EndpointSnapshot,
  type EventSnapshot,
  type GuardSnapshot,
  type PublishedDefinitionsSnapshot,
  type PublishedElement,
  type PublishedServiceSnapshot,
  type SchemaNode,
  type ServiceSnapshot,
  versionBumpOf,
} from '../internal/index.ts';

type Visibility = EndpointSnapshot['visibility'];
type Lifecycle = EndpointSnapshot['lifecycle'];

const identity = 'GET /orders/{}';
const standardRejections: ServiceSnapshot['standardRejections'] = {
  invalidInput: 'INVALID_INPUT',
  notFound: 'NOT_FOUND',
  notImplemented: 'NOT_IMPLEMENTED',
};
const heading = {
  format: 1,
  kind: 'service',
  name: 'orders-service',
  standardRejections,
  defs: {},
  codes: {},
  dependencies: {},
} as const;
const anObject: SchemaNode = { type: 'object', fields: {} };
const noFields = { type: 'object', fields: {} } as const;

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

function anEvent(fields: Partial<EventSnapshot> = {}): EventSnapshot {
  return {
    group: 'orders',
    visibility: 'internal',
    lifecycle: 'active',
    description: 'An order was placed',
    body: { type: 'object', fields: {} },
    ...fields,
  };
}

function aCommand(fields: Partial<CommandSnapshot> = {}): CommandSnapshot {
  return {
    group: 'orders',
    lifecycle: 'active',
    description: 'Charge a card',
    body: { type: 'object', fields: {} },
    ...fields,
  };
}

function aGuard(fields: Partial<GuardSnapshot> = {}): GuardSnapshot {
  return {
    origin: 'local',
    description: 'Authenticates the Caller',
    guards: [],
    qualifier: null,
    demands: { headers: { type: 'object', fields: {} }, query: { type: 'object', fields: {} } },
    context: null,
    rejections: [],
    ...fields,
  };
}

function aCode(fields: Partial<CodeSnapshot> = {}): CodeSnapshot {
  return {
    origin: 'local',
    status: 409,
    message: 'The order is locked',
    body: null,
    removed: false,
    ...fields,
  };
}

/** A Baseline of the declared Elements given, published at 3.4.0 with a Retired one stamped 3.0.0. */
function aBaseline(fields: Partial<ServiceSnapshot> = {}): PublishedServiceSnapshot {
  const { endpoints, events, commands, ...rest } = aProposed(fields);
  return {
    ...rest,
    version: '3.4.0',
    generator: publishedBy,
    endpoints: stamped(endpoints),
    events: stamped(events),
    commands: stamped(commands),
  };
}

function stamped<Element extends { readonly lifecycle: Lifecycle }>(
  elements: Readonly<Record<string, Element>>,
): Readonly<Record<string, PublishedElement<Element>>> {
  const entries = Object.entries(elements).map(([key, element]) => [key, stampedOf(element)]);
  return Object.fromEntries(entries);
}

function stampedOf<Element extends { readonly lifecycle: Lifecycle }>(
  element: Element,
): PublishedElement<Element> {
  return element.lifecycle === 'retired'
    ? { ...element, lifecycle: 'retired', retiredIn: '3.0.0' }
    : { ...element, lifecycle: element.lifecycle };
}

function aProposed(fields: Partial<ServiceSnapshot> = {}): ServiceSnapshot {
  return {
    ...heading,
    endpoints: {},
    events: {},
    commands: {},
    guards: {},
    subscriptions: {},
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

function aBaselineDefinitions(
  fields: Partial<PublishedDefinitionsSnapshot> = {},
): PublishedDefinitionsSnapshot {
  return { ...aDefinitions(), version: '4.2.0', generator: publishedBy, ...fields };
}

function neutral(site: ChangeSite, difference: Difference): Change {
  return { site, difference, class: 'neutral', verdict: 'allowed' };
}

function endpointSite(visibility: Visibility = 'public'): ChangeSite {
  return { kind: 'endpoint', identity, name: 'getOrder', visibility };
}

function guardSite(visibility: Visibility, name = 'authenticated'): ChangeSite {
  return { kind: 'guard', name, visibility };
}

function endpointChangesOf(from: EndpointSnapshot, to: EndpointSnapshot): readonly Change[] {
  const baseline = aBaseline({ endpoints: { [identity]: from } });
  return compatibilityReportOf(baseline, aProposed({ endpoints: { [identity]: to } })).changes;
}

describe('compatibilityReportOf, an Endpoint’s Neutral Changes', () => {
  test('changing only an Endpoint’s description gives one Neutral description-changed at its site', () => {
    const from = anEndpoint();
    const to = anEndpoint({ description: 'Reads one order' });

    const changes = endpointChangesOf(from, to);

    expect(changes).toEqual([neutral(endpointSite(), { kind: 'description-changed' })]);
  });

  test('moving an Endpoint to another Group gives one Neutral group-changed with both Groups', () => {
    const from = anEndpoint();
    const to = anEndpoint({ group: 'fulfilment' });

    const changes = endpointChangesOf(from, to);

    const difference = { kind: 'group-changed', from: 'orders', to: 'fulfilment' } as const;
    expect(changes).toEqual([neutral(endpointSite(), difference)]);
  });

  test.each([
    {
      name: 'reordering the Attachments',
      from: [
        { guard: 'authenticated', qualifier: null },
        { guard: 'traced', qualifier: null },
      ],
      to: [
        { guard: 'traced', qualifier: null },
        { guard: 'authenticated', qualifier: null },
      ],
    },
    {
      name: 'changing a Qualifier',
      from: [{ guard: 'roles', qualifier: ['admin'] }],
      to: [{ guard: 'roles', qualifier: ['admin', 'agent'] }],
    },
  ])('$name gives one Neutral attachments-changed', ({ from, to }) => {
    const changes = endpointChangesOf(anEndpoint({ guards: from }), anEndpoint({ guards: to }));

    expect(changes).toEqual([neutral(endpointSite(), { kind: 'attachments-changed' })]);
  });

  test('attaching a Guard gives its Rejection Changes and attachments-changed', () => {
    const attached = anEndpoint({
      guards: [{ guard: 'authenticated', qualifier: null }],
      rejections: ['UNAUTHENTICATED'],
    });

    const changes = endpointChangesOf(anEndpoint(), attached);

    expect(changes.map(({ difference }) => difference.kind)).toEqual([
      'rejection-added',
      'attachments-changed',
    ]);
  });

  test('moving the deprecatedAt of a Deprecated Endpoint gives one Neutral deprecation-moved with both instants', () => {
    const from = anEndpoint({ lifecycle: 'deprecated', deprecatedAt: '2026-01-01T00:00:00Z' });
    const to = anEndpoint({ lifecycle: 'deprecated', deprecatedAt: '2026-06-01T00:00:00Z' });

    const changes = endpointChangesOf(from, to);

    const difference = {
      kind: 'deprecation-moved',
      from: '2026-01-01T00:00:00Z',
      to: '2026-06-01T00:00:00Z',
    } as const;
    expect(changes).toEqual([neutral(endpointSite(), difference)]);
  });

  test('a Deprecated Endpoint left as it is gives no Change', () => {
    const deprecated = anEndpoint({
      lifecycle: 'deprecated',
      deprecatedAt: '2026-01-01T00:00:00Z',
    });

    const changes = endpointChangesOf(deprecated, deprecated);

    expect(changes).toEqual([]);
  });

  test('deprecating an Endpoint at an instant gives deprecated alone', () => {
    const to = anEndpoint({ lifecycle: 'deprecated', deprecatedAt: '2026-01-01T00:00:00Z' });

    const changes = endpointChangesOf(anEndpoint(), to);

    expect(changes.map(({ difference }) => difference.kind)).toEqual(['deprecated']);
  });

  test('a Neutral Change on a Private Endpoint is still Neutral, on its Private site', () => {
    const from = anEndpoint({ visibility: 'private' });
    const to = anEndpoint({ visibility: 'private', description: 'Reads one order' });

    const changes = endpointChangesOf(from, to);

    expect(changes).toEqual([neutral(endpointSite('private'), { kind: 'description-changed' })]);
  });
});

describe('compatibilityReportOf, a Message Version’s Neutral Changes', () => {
  test.each([
    { name: 'an Event’s', key: 'OrderPlaced@1', event: true },
    { name: 'a Command’s', key: 'ChargeCard@1', event: false },
  ])('changing only $name description gives one Neutral description-changed', (kind) => {
    const site: ChangeSite = kind.event
      ? { kind: 'event', identity: kind.key, visibility: 'internal' }
      : { kind: 'command', identity: kind.key, visibility: 'private' };
    const held = kind.event
      ? { events: { [kind.key]: anEvent() } }
      : { commands: { [kind.key]: aCommand() } };
    const reworded = { description: 'Reworded' };
    const next = kind.event
      ? { events: { [kind.key]: anEvent(reworded) } }
      : { commands: { [kind.key]: aCommand(reworded) } };

    const report = compatibilityReportOf(aBaseline(held), aProposed(next));

    expect(report.changes).toEqual([neutral(site, { kind: 'description-changed' })]);
  });

  test.each([
    { name: 'an Event’s', key: 'OrderPlaced@1', event: true },
    { name: 'a Command’s', key: 'ChargeCard@1', event: false },
  ])('moving $name Message Version to another Group gives one Neutral group-changed', (kind) => {
    const site: ChangeSite = kind.event
      ? { kind: 'event', identity: kind.key, visibility: 'internal' }
      : { kind: 'command', identity: kind.key, visibility: 'private' };
    const held = kind.event
      ? { events: { [kind.key]: anEvent() } }
      : { commands: { [kind.key]: aCommand() } };
    const moved = { group: 'billing' };
    const next = kind.event
      ? { events: { [kind.key]: anEvent(moved) } }
      : { commands: { [kind.key]: aCommand(moved) } };

    const report = compatibilityReportOf(aBaseline(held), aProposed(next));

    const difference = { kind: 'group-changed', from: 'orders', to: 'billing' } as const;
    expect(report.changes).toEqual([neutral(site, difference)]);
  });
});

describe('compatibilityReportOf, a Service’s Guard', () => {
  const attaching = (visibility: Visibility) =>
    anEndpoint({ visibility, guards: [{ guard: 'authenticated', qualifier: null }] });

  function guardChangesOf(from: GuardSnapshot, to: GuardSnapshot, endpoint: EndpointSnapshot) {
    const baseline = aBaseline({
      endpoints: { [identity]: endpoint },
      guards: { authenticated: from },
    });
    const proposed = aProposed({
      endpoints: { [identity]: endpoint },
      guards: { authenticated: to },
    });
    return compatibilityReportOf(baseline, proposed).changes;
  }

  test.each([
    {
      what: 'description',
      field: { description: 'Checks the session' },
      difference: { kind: 'description-changed' },
    },
    { what: 'Guards', field: { guards: ['session'] }, difference: { kind: 'guards-changed' } },
    {
      what: 'Qualifier',
      field: { qualifier: { type: 'string' } },
      difference: { kind: 'qualifier-changed' },
    },
    { what: 'Context', field: { context: anObject }, difference: { kind: 'context-changed' } },
    {
      what: 'origin',
      field: { origin: '@org/definitions@5.0.0#authenticated' },
      difference: {
        kind: 'origin-changed',
        from: 'local',
        to: '@org/definitions@5.0.0#authenticated',
      },
    },
  ] as const)('a Guard whose $what changed gives that Neutral Change', (row) => {
    const changes = guardChangesOf(aGuard(), aGuard(row.field), attaching('internal'));

    expect(changes).toEqual([neutral(guardSite('internal'), row.difference)]);
  });

  test('a Guard’s site takes the widest Visibility of the Endpoints that attach it', () => {
    const baseline = aBaseline({
      endpoints: {
        [identity]: attaching('internal'),
        'GET /orders/{}/audit': { ...attaching('public'), name: 'auditOrder' },
      },
      guards: { authenticated: aGuard() },
    });
    const proposed = aProposed({
      endpoints: baseline.endpoints as ServiceSnapshot['endpoints'],
      guards: { authenticated: aGuard({ description: 'Checks the session' }) },
    });

    const { changes } = compatibilityReportOf(baseline, proposed);

    const description = { kind: 'description-changed' } as const;
    expect(changes).toEqual([neutral(guardSite('public'), description)]);
  });

  test('a Guard no Endpoint attaches in either Snapshot is on a Private site', () => {
    const baseline = aBaseline({ guards: { authenticated: aGuard() } });
    const proposed = aProposed({
      guards: { authenticated: aGuard({ description: 'Checks the session' }) },
    });

    const { changes } = compatibilityReportOf(baseline, proposed);

    const description = { kind: 'description-changed' } as const;
    expect(changes).toEqual([neutral(guardSite('private'), description)]);
  });

  test('a Guard whose demands and Rejections changed is reported at its Endpoints, and beside them on the Guard', () => {
    const from = attaching('public');
    const to = {
      ...attaching('public'),
      input: {
        ...from.input,
        headers: {
          type: 'object',
          fields: { authorization: { required: true, schema: { type: 'string' } } },
        },
      },
      rejections: ['UNAUTHENTICATED'],
    } as const;
    const demanding = aGuard({
      demands: {
        headers: {
          type: 'object',
          fields: { authorization: { required: true, schema: { type: 'string' } } },
        },
        query: { type: 'object', fields: {} },
      },
      rejections: ['UNAUTHENTICATED'],
    });
    const baseline = aBaseline({
      endpoints: { [identity]: from },
      guards: { authenticated: aGuard() },
    });
    const proposed = aProposed({
      endpoints: { [identity]: to },
      guards: { authenticated: demanding },
    });

    const { changes } = compatibilityReportOf(baseline, proposed);

    expect(changes.map(({ site, difference }) => [site.kind, difference.kind])).toEqual([
      ['endpoint', 'schema'],
      ['endpoint', 'rejection-added'],
      ['guard', 'demands-changed'],
      ['guard', 'rejections-changed'],
    ]);
  });

  test('a Guard relaxing a demand the Endpoint declares too is told on the Guard, since the Endpoint’s Input did not change', () => {
    const own = { authorization: { required: true, schema: { type: 'string' } } } as const;
    const endpoint = anEndpoint({
      guards: [{ guard: 'authenticated', qualifier: null }],
      input: { ...anEndpoint().input, headers: { type: 'object', fields: own } },
    });
    const demanding = (required: boolean) =>
      aGuard({
        demands: {
          headers: {
            type: 'object',
            fields: { authorization: { required, schema: { type: 'string' } } },
          },
          query: { type: 'object', fields: {} },
        },
      });
    const baseline = aBaseline({
      endpoints: { [identity]: endpoint },
      guards: { authenticated: demanding(true) },
    });
    const proposed = aProposed({
      endpoints: { [identity]: endpoint },
      guards: { authenticated: demanding(false) },
    });

    const { changes } = compatibilityReportOf(baseline, proposed);

    expect(changes).toEqual([neutral(guardSite('public'), { kind: 'demands-changed' })]);
  });

  test('a Guard dropping a Rejection the Endpoint lists too is told on the Guard', () => {
    const endpoint = anEndpoint({
      guards: [{ guard: 'authenticated', qualifier: null }],
      rejections: ['UNAUTHENTICATED'],
    });
    const baseline = aBaseline({
      endpoints: { [identity]: endpoint },
      guards: { authenticated: aGuard({ rejections: ['UNAUTHENTICATED'] }) },
    });
    const proposed = aProposed({
      endpoints: { [identity]: endpoint },
      guards: { authenticated: aGuard() },
    });

    const { changes } = compatibilityReportOf(baseline, proposed);

    expect(changes).toEqual([neutral(guardSite('public'), { kind: 'rejections-changed' })]);
  });
});

describe('compatibilityReportOf, a Definitions Package’s Guard', () => {
  test.each([
    {
      what: 'description',
      field: { description: 'Checks the session' },
      difference: { kind: 'description-changed' },
    },
    { what: 'Guards', field: { guards: ['session'] }, difference: { kind: 'guards-changed' } },
    {
      what: 'Qualifier',
      field: { qualifier: { type: 'string' } },
      difference: { kind: 'qualifier-changed' },
    },
    { what: 'Context', field: { context: anObject }, difference: { kind: 'context-changed' } },
    {
      what: 'origin',
      field: { origin: '@org/definitions@5.0.0#authenticated' },
      difference: {
        kind: 'origin-changed',
        from: 'local',
        to: '@org/definitions@5.0.0#authenticated',
      },
    },
  ] as const)('a Guard whose $what changed gives that Neutral Change, Public', (row) => {
    const baseline = aBaselineDefinitions({ guards: { authenticated: aGuard() } });
    const proposed = aDefinitions({ guards: { authenticated: aGuard(row.field) } });

    const { changes } = compatibilityReportOf(baseline, proposed);

    expect(changes).toEqual([neutral(guardSite('public'), row.difference)]);
  });

  test('a Guard’s Neutral Changes come after its Rejection Changes', () => {
    const baseline = aBaselineDefinitions({ guards: { authenticated: aGuard() } });
    const changed = aGuard({ description: 'Checks the session', rejections: ['UNAUTHENTICATED'] });
    const proposed = aDefinitions({ guards: { authenticated: changed } });

    const { changes } = compatibilityReportOf(baseline, proposed);

    expect(changes.map(({ difference }) => difference.kind)).toEqual([
      'rejection-added',
      'description-changed',
    ]);
  });
});

describe('compatibilityReportOf, a code’s Neutral Changes', () => {
  const orderLocked = 'ORDER_LOCKED';
  const codeSite = (visibility: Visibility): ChangeSite => ({
    kind: 'code',
    code: orderLocked,
    visibility,
  });

  test.each([
    { name: 'message', field: { message: 'Frozen' }, difference: { kind: 'message-changed' } },
    {
      name: 'origin',
      field: { origin: '@org/definitions@2.0.0#orderLocked' },
      difference: {
        kind: 'origin-changed',
        from: 'local',
        to: '@org/definitions@2.0.0#orderLocked',
      },
    },
  ] as const)('a Service’s code whose $name changed gives one Neutral Change', (row) => {
    const answering = anEndpoint({ rejections: [orderLocked] });
    const baseline = aBaseline({
      endpoints: { [identity]: answering },
      codes: { [orderLocked]: aCode() },
    });
    const proposed = aProposed({
      endpoints: { [identity]: answering },
      codes: { [orderLocked]: aCode(row.field) },
    });

    const { changes } = compatibilityReportOf(baseline, proposed);

    expect(changes).toEqual([neutral(codeSite('public'), row.difference)]);
  });

  test.each([
    { name: 'message', field: { message: 'Frozen' }, kind: 'message-changed' },
    { name: 'origin', field: { origin: '@org/definitions@2.0.0#x' }, kind: 'origin-changed' },
  ] as const)('a Definitions Package’s code whose $name changed gives it, Public', (row) => {
    const baseline = aBaselineDefinitions({ codes: { [orderLocked]: aCode() } });
    const proposed = aDefinitions({ codes: { [orderLocked]: aCode(row.field) } });

    const { changes } = compatibilityReportOf(baseline, proposed);

    expect(changes.map(({ site, difference }) => [site, difference.kind])).toEqual([
      [codeSite('public'), row.kind],
    ]);
  });
});

describe('compatibilityReportOf, an Element Retired in the proposed Snapshot', () => {
  const retired = (fields: Partial<EndpointSnapshot> = {}) =>
    anEndpoint({ ...fields, lifecycle: 'retired' });

  test.each([
    { name: 'description', fields: { description: 'Reworded' } },
    { name: 'Group', fields: { group: 'archive' } },
    {
      name: 'Success status',
      fields: { success: { status: 201, headers: { type: 'object', fields: {} }, body: null } },
    },
    { name: 'Visibility', fields: { visibility: 'private' } },
  ] as const)(
    'a Retired Endpoint whose $name changed gives one Neutral retired-changed',
    ({ fields }) => {
      const baseline = aBaseline({ endpoints: { [identity]: retired() } });
      const proposed = aProposed({
        endpoints: { [identity]: anEndpoint({ ...fields, lifecycle: 'retired' }) },
      });

      const { changes } = compatibilityReportOf(baseline, proposed);

      expect(changes).toEqual([neutral(endpointSite('public'), { kind: 'retired-changed' })]);
    },
  );

  test('a Retired Endpoint, Event or Command whose body changed gives one retired-changed', () => {
    const body: SchemaNode = {
      type: 'object',
      fields: { id: { required: true, schema: { type: 'string' } } },
    };
    const baseline = aBaseline({
      events: { 'OrderPlaced@1': anEvent({ lifecycle: 'retired' }) },
      commands: { 'ChargeCard@1': aCommand({ lifecycle: 'retired' }) },
    });
    const proposed = aProposed({
      events: { 'OrderPlaced@1': anEvent({ lifecycle: 'retired', body }) },
      commands: { 'ChargeCard@1': aCommand({ lifecycle: 'retired', body }) },
    });

    const { changes } = compatibilityReportOf(baseline, proposed);

    expect(changes.map(({ site, difference }) => [site.kind, difference.kind])).toEqual([
      ['event', 'retired-changed'],
      ['command', 'retired-changed'],
    ]);
  });

  test('a def only a Retired Endpoint reaches, changed, gives one retired-changed', () => {
    const body = { type: 'ref', name: 'tree' } as const;
    const success = { status: 200, headers: noFields, body };
    const tree = (description: string): SchemaNode => ({ type: 'object', fields: {}, description });
    const baseline = aBaseline({
      endpoints: { [identity]: retired({ success }) },
      defs: { tree: tree('A tree') },
    });
    const proposed = aProposed({
      endpoints: { [identity]: anEndpoint({ lifecycle: 'retired', success }) },
      defs: { tree: tree('A leafy tree') },
    });

    const { changes } = compatibilityReportOf(baseline, proposed);

    expect(changes).toEqual([neutral(endpointSite('public'), { kind: 'retired-changed' })]);
  });

  test('retiring an Element and changing it in the same change gives retired and retired-changed', () => {
    const baseline = aBaseline({
      endpoints: { [identity]: anEndpoint({ lifecycle: 'deprecated' }) },
    });
    const proposed = aProposed({
      endpoints: { [identity]: anEndpoint({ lifecycle: 'retired', description: 'Reworded' }) },
    });

    const { changes } = compatibilityReportOf(baseline, proposed);

    expect(changes.map(({ difference }) => difference.kind)).toEqual([
      'retired',
      'retired-changed',
    ]);
  });

  test('a Retired Endpoint left as it is gives no Change', () => {
    const baseline = aBaseline({ endpoints: { [identity]: retired() } });
    const proposed = aProposed({ endpoints: { [identity]: anEndpoint({ lifecycle: 'retired' }) } });

    const { changes } = compatibilityReportOf(baseline, proposed);

    expect(changes).toEqual([]);
  });
});

describe('compatibilityReportOf, every Neutral Change', () => {
  const unmoved = { baseline: { zod: '^4.1.0' }, proposed: { zod: '^4.1.0' } };
  const guarded = anEndpoint({ guards: [{ guard: 'authenticated', qualifier: null }] });
  const orderLocked = 'ORDER_LOCKED';
  const answering = anEndpoint({ rejections: [orderLocked] });

  const reports: readonly (readonly [string, PublishedServiceSnapshot, ServiceSnapshot])[] = [
    [
      'an Endpoint’s description and Group',
      aBaseline({ endpoints: { [identity]: anEndpoint() } }),
      aProposed({
        endpoints: { [identity]: anEndpoint({ description: 'Reworded', group: 'archive' }) },
      }),
    ],
    [
      'a Deprecated Endpoint’s deprecatedAt',
      aBaseline({
        endpoints: {
          [identity]: anEndpoint({ lifecycle: 'deprecated', deprecatedAt: '2026-01-01T00:00:00Z' }),
        },
      }),
      aProposed({
        endpoints: {
          [identity]: anEndpoint({ lifecycle: 'deprecated', deprecatedAt: '2026-06-01T00:00:00Z' }),
        },
      }),
    ],
    [
      'an Endpoint’s Attachments',
      aBaseline({ endpoints: { [identity]: guarded } }),
      aProposed({ endpoints: { [identity]: anEndpoint({ guards: [] }) } }),
    ],
    [
      'a Guard’s description, Guards, Qualifier, Context and origin',
      aBaseline({ endpoints: { [identity]: guarded }, guards: { authenticated: aGuard() } }),
      aProposed({
        endpoints: { [identity]: guarded },
        guards: {
          authenticated: aGuard({
            description: 'Reworded',
            guards: ['session'],
            qualifier: { type: 'string' },
            context: anObject,
            origin: '@org/definitions@5.0.0#authenticated',
          }),
        },
      }),
    ],
    [
      'a code’s message and origin',
      aBaseline({ endpoints: { [identity]: answering }, codes: { [orderLocked]: aCode() } }),
      aProposed({
        endpoints: { [identity]: answering },
        codes: { [orderLocked]: aCode({ message: 'Frozen', origin: '@org/definitions@2.0.0#x' }) },
      }),
    ],
    [
      'what a Retired Endpoint declares',
      aBaseline({ endpoints: { [identity]: anEndpoint({ lifecycle: 'retired' }) } }),
      aProposed({
        endpoints: { [identity]: anEndpoint({ lifecycle: 'retired', description: 'Reworded' }) },
      }),
    ],
  ];

  test.each(reports)(
    '%s is Neutral and allowed, and bumps patch on a Public site',
    (_name, baseline, proposed) => {
      const report = compatibilityReportOf(baseline, proposed);

      expect(report.changes.length).toBeGreaterThan(0);
      expect(new Set(report.changes.map(({ class: c, verdict }) => `${c} ${verdict}`))).toEqual(
        new Set(['neutral allowed']),
      );
      expect(versionBumpOf(report, unmoved)).toBe('patch');
    },
  );
});
