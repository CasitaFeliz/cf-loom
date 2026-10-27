import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { aRootPackage } from '../../test/root-package.ts';
import { publishedAt } from '../../test/snapshots.ts';
import {
  defineDefinitions,
  defineEndpoint,
  defineEvent,
  defineGroup,
  defineGuard,
  defineRejection,
  defineService,
} from '../index.ts';
import {
  type CodeSnapshot,
  type EndpointPath,
  type EndpointSnapshot,
  type EventSnapshot,
  endpointPathOf,
  exportedCutOf,
  exportedSnapshotOf,
  type GuardSnapshot,
  matchOf,
  type ObjectNode,
  type PublishedServiceSnapshot,
  type ResolvedDefinitions,
  type SchemaNode,
  type ServiceSnapshot,
  snapshotOf,
  validateRoot,
} from '../internal/index.ts';

function aServiceSnapshot(fields: Partial<ServiceSnapshot> = {}): ServiceSnapshot {
  return {
    format: 1,
    kind: 'service',
    name: 'orders-service',
    standardRejections: {
      invalidInput: 'INVALID_INPUT',
      notFound: 'NOT_FOUND',
      notImplemented: 'NOT_IMPLEMENTED',
    },
    groups: {},
    defs: {},
    endpoints: {},
    events: {},
    commands: {},
    guards: {},
    codes: {},
    subscriptions: {},
    dependencies: {},
    ...fields,
  };
}

function anEndpointEntry(fields: Partial<EndpointSnapshot> = {}): EndpointSnapshot {
  return {
    name: 'getOrder',
    group: 'orders',
    visibility: 'public',
    lifecycle: 'active',
    description: 'One order',
    params: [],
    guards: [],
    input: {
      params: null,
      query: { type: 'object', fields: {} },
      headers: { type: 'object', fields: {} },
      body: null,
    },
    success: { status: 200, headers: { type: 'object', fields: {} }, body: null },
    rejections: [],
    ...fields,
  };
}

function aGuardEntry(fields: Partial<GuardSnapshot> = {}): GuardSnapshot {
  return {
    origin: 'orders-service',
    description: 'A Guard',
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
    origin: 'orders-service',
    status: 409,
    message: 'Conflict',
    headers: { type: 'object', fields: {} },
    body: null,
    ...fields,
  };
}

function anEventEntry(fields: Partial<EventSnapshot> = {}): EventSnapshot {
  return {
    group: 'orders',
    visibility: 'internal',
    lifecycle: 'active',
    description: 'An order was placed',
    body: { type: 'object', fields: {} },
    ...fields,
  };
}

function aRef(name: string): SchemaNode {
  return { type: 'ref', name };
}

function anObjectWith(node: SchemaNode): ObjectNode {
  return { type: 'object', fields: { item: { required: true, schema: node } } };
}

const aString: SchemaNode = { type: 'string' };

/** An Endpoint's entry that attaches the Guards named, each without a Qualifier. */
function attaching(...guards: readonly string[]): EndpointSnapshot {
  return anEndpointEntry({ guards: guards.map((guard) => ({ guard, qualifier: null })) });
}

/** A code a Rejection of the Service's own answers with. */
const orderLocked = 'ORDER_LOCKED';

const codeA = 'CODE_A';
const codeB = 'CODE_B';
const codeC = 'CODE_C';

const privateEntry = anEndpointEntry({ name: 'purgeOrders', visibility: 'private' });

const noFields = { type: 'object', fields: {} } as const;

describe('exportedSnapshotOf', () => {
  test.each([
    ['public', 'active', true],
    ['public', 'deprecated', true],
    ['public', 'retired', false],
    ['internal', 'active', true],
    ['internal', 'deprecated', true],
    ['internal', 'retired', false],
    ['private', 'active', false],
    ['private', 'deprecated', false],
    ['private', 'retired', false],
  ] as const)(
    'an Endpoint %s and %s is exported: %s, only when Public or Internal and not Retired',
    (visibility, lifecycle, exported) => {
      const endpoints = { 'GET /orders': anEndpointEntry({ visibility, lifecycle }) };

      const cut = exportedSnapshotOf(aServiceSnapshot({ endpoints }));

      expect(Object.keys(cut.endpoints)).toEqual(exported ? ['GET /orders'] : []);
    },
  );

  test('the exported Snapshot holds format, defs, endpoints, events, guards and codes, nothing of the heading but format, and no shadowing', () => {
    const snapshot = aServiceSnapshot();

    const cut = exportedSnapshotOf(snapshot);

    expect(cut).toStrictEqual({
      format: 1,
      defs: {},
      endpoints: {},
      events: {},
      guards: {},
      codes: {},
    });
  });

  test('an Internal Event that is not Retired is kept by identity; a Private or a Retired one is cut', () => {
    const events = {
      'OrderPlaced@1': anEventEntry(),
      'StockReserved@1': anEventEntry({ visibility: 'private' }),
      'OrderPurged@1': anEventEntry({ lifecycle: 'retired' }),
    };

    const cut = exportedSnapshotOf(aServiceSnapshot({ events }));

    expect(cut.events).toEqual({ 'OrderPlaced@1': events['OrderPlaced@1'] });
  });

  test('an exported Event keeps its Group', () => {
    const events = { 'OrderPlaced@1': anEventEntry({ group: 'billing' }) };

    const cut = exportedSnapshotOf(aServiceSnapshot({ events }));

    expect(cut.events['OrderPlaced@1']?.group).toBe('billing');
  });

  test('a Deprecated Internal Event is kept', () => {
    const events = { 'OrderPlaced@1': anEventEntry({ lifecycle: 'deprecated' }) };

    const cut = exportedSnapshotOf(aServiceSnapshot({ events }));

    expect(cut.events).toEqual(events);
  });

  test('a def only an exported Event’s body reaches is kept; one only a Private Event’s reaches is cut', () => {
    const events = {
      'OrderPlaced@1': anEventEntry({ body: anObjectWith(aRef('tree')) }),
      'StockReserved@1': anEventEntry({ visibility: 'private', body: aRef('stock') }),
    };
    const defs = { stock: aString, tree: aString };

    const cut = exportedSnapshotOf(aServiceSnapshot({ events, defs }));

    expect(cut.defs).toEqual({ tree: aString });
  });

  test('a Guard an exported Endpoint attaches is kept; one only a Private or Retired Endpoint attaches is cut', () => {
    const endpoints = {
      'GET /orders': attaching('apiKey'),
      'DELETE /orders': { ...attaching('admin'), visibility: 'private' as const },
      'POST /orders': { ...attaching('legacyKey'), lifecycle: 'retired' as const },
    };
    const guards = { admin: aGuardEntry(), apiKey: aGuardEntry(), legacyKey: aGuardEntry() };

    const cut = exportedSnapshotOf(aServiceSnapshot({ endpoints, guards }));

    expect(cut.guards).toEqual({ apiKey: guards.apiKey });
  });

  test.each([
    { reach: 'at depth 1', listed: { g0: ['g1'], g1: [] }, kept: ['g0', 'g1'] },
    { reach: 'at depth 2', listed: { g0: ['g1'], g1: ['g2'], g2: [] }, kept: ['g0', 'g1', 'g2'] },
    {
      reach: 'at depth 3',
      listed: { g0: ['g1'], g1: ['g2'], g2: ['g3'], g3: [] },
      kept: ['g0', 'g1', 'g2', 'g3'],
    },
    { reach: 'round a cycle', listed: { g0: ['g1'], g1: ['g0'] }, kept: ['g0', 'g1'] },
  ])(
    'a Guard reached through a reached Guard’s guards $reach is kept, even unattached',
    ({ listed, kept }) => {
      const guards = Object.fromEntries(
        Object.entries(listed).map(([name, names]) => [name, aGuardEntry({ guards: names })]),
      );
      const endpoints = { 'GET /orders': attaching('g0') };

      const cut = exportedSnapshotOf(
        aServiceSnapshot({ endpoints, guards: { ...guards, gX: aGuardEntry() } }),
      );

      expect(Object.keys(cut.guards)).toEqual(kept);
    },
  );

  test('a name an Endpoint attaches that the Snapshot holds no Guard for is not kept', () => {
    const endpoints = { 'GET /orders': attaching('gZ') };

    const cut = exportedSnapshotOf(aServiceSnapshot({ endpoints }));

    expect(cut.guards).toEqual({});
  });

  test.each([
    {
      reach: 'an exported Endpoint lists itself',
      entry: anEndpointEntry({ rejections: [orderLocked] }),
      guards: {},
      kept: [orderLocked],
    },
    {
      reach: 'a Guard it attaches answers',
      entry: attaching('apiKey'),
      guards: { apiKey: aGuardEntry({ rejections: [orderLocked] }) },
      kept: [orderLocked],
    },
    {
      reach: 'a Guard its Guard lists answers',
      entry: attaching('apiKey'),
      guards: {
        apiKey: aGuardEntry({ guards: ['user'] }),
        user: aGuardEntry({ rejections: [orderLocked] }),
      },
      kept: [orderLocked],
    },
    {
      reach: 'a Guard its Guard’s Guard lists answers',
      entry: attaching('apiKey'),
      guards: {
        apiKey: aGuardEntry({ guards: ['session'] }),
        session: aGuardEntry({ guards: ['user'] }),
        user: aGuardEntry({ rejections: [orderLocked] }),
      },
      kept: [orderLocked],
    },
    { reach: 'only a Private Endpoint lists', entry: anEndpointEntry(), guards: {}, kept: [] },
  ])('a code $reach: the codes kept are $kept', ({ entry, guards, kept }) => {
    const purging = { ...privateEntry, rejections: [orderLocked] };
    const endpoints = { 'GET /orders': entry, 'DELETE /orders': purging };
    const codes = { [orderLocked]: aCode() };

    const cut = exportedSnapshotOf(aServiceSnapshot({ endpoints, guards, codes }));

    expect(Object.keys(cut.codes)).toEqual(kept);
  });

  test.each([
    { reach: 'a Guard at the end of the attached chain answers', code: 'DEEP', kept: true },
    { reach: 'only a Public Endpoint lists', code: orderLocked, kept: true },
    { reach: 'only a Private Endpoint lists', code: 'PURGED', kept: false },
    {
      reach:
        'only an imported Definitions Package declares, which the declared Snapshot never writes',
      code: 'UNUSED',
      kept: false,
    },
  ])('a code $reach, cut from the declared Snapshot, is kept: $kept', ({ code, kept }) => {
    const snapshot = codeReachSnapshot();

    const cut = exportedSnapshotOf(snapshot);

    expect(code in cut.codes).toBe(kept);
  });

  test('the Standard Rejections’ codes are left to standardRejections, notFound included when an Endpoint lists it', () => {
    const rejections = ['INVALID_INPUT', 'NOT_FOUND', 'NOT_IMPLEMENTED', 'ORDER_LOCKED'];
    const endpoints = { 'GET /orders': anEndpointEntry({ rejections }) };
    const codes = Object.fromEntries(rejections.map((code) => [code, aCode()]));

    const cut = exportedSnapshotOf(aServiceSnapshot({ endpoints, codes }));

    expect(Object.keys(cut.codes)).toEqual(['ORDER_LOCKED']);
  });

  test.each([
    [
      'input.params',
      {
        endpoint: {
          input: {
            params: anObjectWith(aRef('tree')),
            query: { type: 'object', fields: {} },
            headers: { type: 'object', fields: {} },
            body: null,
          },
        },
      },
    ],
    [
      'input.headers',
      {
        endpoint: {
          input: {
            params: null,
            query: { type: 'object', fields: {} },
            headers: anObjectWith(aRef('tree')),
            body: null,
          },
        },
      },
    ],
    [
      'input.body',
      {
        endpoint: {
          input: {
            params: null,
            query: { type: 'object', fields: {} },
            headers: { type: 'object', fields: {} },
            body: aRef('tree'),
          },
        },
      },
    ],
    [
      'input.query',
      {
        endpoint: {
          input: {
            params: null,
            query: anObjectWith(aRef('tree')),
            headers: { type: 'object', fields: {} },
            body: null,
          },
        },
      },
    ],
    [
      'success.headers',
      { endpoint: { success: { status: 200, headers: anObjectWith(aRef('tree')), body: null } } },
    ],
    [
      'success.body',
      {
        endpoint: {
          success: { status: 200, headers: noFields, body: aRef('tree') },
        },
      },
    ],
    ['a Guard’s context', { guard: { context: aRef('tree') } }],
    ['a Guard’s qualifier', { guard: { qualifier: aRef('tree') } }],
    [
      'a Guard’s demands headers',
      {
        guard: {
          demands: { headers: anObjectWith(aRef('tree')), query: { type: 'object', fields: {} } },
        },
      },
    ],
    [
      'a Guard’s demands query',
      {
        guard: {
          demands: { headers: { type: 'object', fields: {} }, query: anObjectWith(aRef('tree')) },
        },
      },
    ],
    ['a code’s headers', { code: { headers: anObjectWith(aRef('tree')) } }],
    ['a code’s body', { code: { body: aRef('tree') } }],
  ] as const)('a def a node at %s of what is exported reaches is kept', (_, at) => {
    const endpoint = {
      ...attaching('apiKey'),
      rejections: [orderLocked],
      ...('endpoint' in at ? at.endpoint : {}),
    };
    const guards = { apiKey: aGuardEntry('guard' in at ? at.guard : {}) };
    const codes = { [orderLocked]: aCode('code' in at ? at.code : {}) };
    const defs = { other: aString, tree: aString };
    const snapshot = aServiceSnapshot({
      endpoints: { 'GET /orders': endpoint },
      guards,
      codes,
      defs,
    });

    const cut = exportedSnapshotOf(snapshot);

    expect(cut.defs).toEqual({ tree: aString });
  });

  test('a def reached only through another def is kept, a cycle once', () => {
    const defs = {
      a: anObjectWith(aRef('b')),
      b: anObjectWith(aRef('c')),
      c: anObjectWith(aRef('a')),
      d: aString,
    };
    const endpoint = anEndpointEntry({
      success: { status: 200, headers: { type: 'object', fields: {} }, body: aRef('a') },
    });

    const cut = exportedSnapshotOf(
      aServiceSnapshot({ endpoints: { 'GET /orders': endpoint }, defs }),
    );

    expect(cut.defs).toEqual({ a: defs.a, b: defs.b, c: defs.c });
  });

  test.each([
    {
      through: 'its own success body',
      purging: {
        ...privateEntry,
        success: { status: 200, headers: noFields, body: aRef('tree') },
      },
      guards: {},
      codes: {},
    },
    {
      through: 'the context of a Guard only it attaches',
      purging: { ...privateEntry, guards: [{ guard: 'admin', qualifier: null }] },
      guards: { admin: aGuardEntry({ context: aRef('tree') }) },
      codes: {},
    },
    {
      through: 'the body of a code only it lists',
      purging: { ...privateEntry, rejections: [orderLocked] },
      guards: {},
      codes: { [orderLocked]: aCode({ body: aRef('tree') }) },
    },
  ])(
    'a def only a Private Endpoint reaches, through $through, is cut',
    ({ purging, guards, codes }) => {
      const endpoints = { 'GET /orders': anEndpointEntry(), 'DELETE /orders': purging };
      const snapshot = aServiceSnapshot({ endpoints, guards, codes, defs: { tree: aString } });

      const cut = exportedSnapshotOf(snapshot);

      expect(cut.defs).toEqual({});
    },
  );

  test('every map keeps the Snapshot’s order', () => {
    const endpoint = {
      ...attaching('zeta', 'alpha'),
      rejections: ['Z_CODE', 'A_CODE'],
      success: {
        status: 200,
        headers: noFields,
        body: anObjectWith({ type: 'union', options: [aRef('z'), aRef('a')] }),
      },
    };
    const snapshot = aServiceSnapshot({
      endpoints: { 'GET /z': { ...endpoint, name: 'z' }, 'GET /a': { ...endpoint, name: 'a' } },
      guards: { alpha: aGuardEntry(), zeta: aGuardEntry() },
      codes: Object.fromEntries([
        ['A_CODE', aCode()],
        ['Z_CODE', aCode()],
      ]),
      events: { 'Z@1': anEventEntry(), 'A@1': anEventEntry() },
      defs: { a: aString, z: aString },
    });

    const cut = exportedSnapshotOf(snapshot);

    expect(Object.keys(cut.endpoints)).toEqual(['GET /z', 'GET /a']);
    expect(Object.keys(cut.events)).toEqual(['Z@1', 'A@1']);
    expect(Object.keys(cut.guards)).toEqual(['alpha', 'zeta']);
    expect(Object.keys(cut.codes)).toEqual(['A_CODE', 'Z_CODE']);
    expect(Object.keys(cut.defs)).toEqual(['a', 'z']);
  });

  test('a published Snapshot’s tombstones and still-declared Retired Elements are left out of the exported Snapshot', () => {
    const published: PublishedServiceSnapshot = {
      ...aServiceSnapshot(),
      ...publishedAt('3.4.0'),
      commands: {},
      subscriptions: {},
      endpoints: {
        'GET /orders': { ...anEndpointEntry(), lifecycle: 'active' },
        'GET /legacy': { ...anEndpointEntry(), lifecycle: 'retired', retiredIn: '3.0.0' },
        'DELETE /orders': { lifecycle: 'retired', retiredIn: '3.0.0', name: 'purgeOrders' },
      },
      events: {
        'OrderPlaced@1': { ...anEventEntry(), lifecycle: 'active' },
        'OrderCancelled@1': { ...anEventEntry(), lifecycle: 'retired', retiredIn: '3.0.0' },
        'OrderPurged@1': { lifecycle: 'retired', retiredIn: '3.1.0' },
      },
    };

    const cut = exportedSnapshotOf(published);

    expect(Object.keys(cut.endpoints)).toEqual(['GET /orders']);
    expect(Object.keys(cut.events)).toEqual(['OrderPlaced@1']);
  });

  test('the cut of a declared Contract keeps each exported Endpoint’s entry as the Snapshot writes it', () => {
    const snapshot = declaredSnapshot();

    const cut = exportedSnapshotOf(snapshot);

    expect(cut).toEqual({
      format: 1,
      defs: {},
      endpoints: { 'GET /orders/{}': snapshot.endpoints['GET /orders/{}'] },
      events: {},
      guards: { apiKey: snapshot.guards['apiKey'] },
      codes: { [orderLocked]: snapshot.codes[orderLocked] },
    });
  });

  test('the cut of a declared Contract keeps each exported Event’s entry as the Snapshot writes it', () => {
    const snapshot = eventsSnapshot();

    const cut = exportedSnapshotOf(snapshot);

    expect(cut.events).toEqual({
      'OrderPlaced@1': snapshot.events['OrderPlaced@1'],
      'OrderPlaced@2': snapshot.events['OrderPlaced@2'],
    });
  });

  test('the cut of a declared Contract whose Endpoints are all exported keeps every Guard its Snapshot writes', () => {
    const snapshot = sharedGuardsSnapshot();

    const cut = exportedSnapshotOf(snapshot);

    expect({ cut: Object.keys(cut.guards), written: Object.keys(snapshot.guards) }).toEqual({
      cut: ['userToken', 'permission'],
      written: ['userToken', 'permission'],
    });
  });
});

describe('exportedCutOf', () => {
  test('the cut of an exported Endpoint holds its entry, the Guards, codes and defs it reaches and its shadowing, with no events key', () => {
    const snapshot = reachingSnapshot();

    const cut = exportedCutOf(snapshot, 'GET /a');

    expect(cut).toStrictEqual({
      format: 1,
      defs: { dA: aString },
      endpoints: { 'GET /a': snapshot.endpoints['GET /a'] },
      guards: { gA: snapshot.guards['gA'] },
      codes: { [codeA]: snapshot.codes[codeA] },
      shadowing: {},
    });
  });

  test.each([
    ['a Private Endpoint', 'GET /private'],
    ['a Retired Endpoint', 'GET /retired'],
    ['an Endpoint the Snapshot does not hold', 'GET /missing'],
  ])('%s has no cut', (_, identity) => {
    const endpoints = {
      'GET /private': anEndpointEntry({ visibility: 'private' }),
      'GET /retired': anEndpointEntry({ lifecycle: 'retired' }),
    };

    const cutting = () => exportedCutOf(aServiceSnapshot({ endpoints }), identity);

    expect(cutting).toThrow(`${identity} is no Endpoint a Contract Package exports`);
  });

  test.each([
    ['declared', declaredSnapshot],
    ['shared Guards', sharedGuardsSnapshot],
    ['reached codes', codeReachSnapshot],
    ['Events', eventsSnapshot],
    ['reaching', reachingSnapshot],
  ])(
    'the cuts of every Endpoint of a Contract with %s hold together the exported Snapshot’s Guards and codes, and with its Events’ defs, its defs',
    (_, snapshotOf) => {
      const snapshot = snapshotOf();
      const whole = exportedSnapshotOf(snapshot);
      const cuts = Object.keys(whole.endpoints).map((identity) =>
        exportedCutOf(snapshot, identity),
      );
      const eventsOnly = exportedSnapshotOf({ ...snapshot, endpoints: {} });

      const together = {
        guards: Object.fromEntries(cuts.flatMap((cut) => Object.entries(cut.guards))),
        codes: Object.fromEntries(cuts.flatMap((cut) => Object.entries(cut.codes))),
        defs: Object.fromEntries([...cuts, eventsOnly].flatMap((cut) => Object.entries(cut.defs))),
      };

      expect(together).toEqual({ guards: whole.guards, codes: whole.codes, defs: whole.defs });
    },
  );
});

describe('exportedCutOf, the declared Endpoints that win a URL its Endpoint matches', () => {
  const exportedParam = anEndpointEntry({ params: ['paymentId'] });

  test.each([
    { visibility: 'public', lifecycle: 'active' },
    { visibility: 'public', lifecycle: 'deprecated' },
    { visibility: 'internal', lifecycle: 'active' },
    { visibility: 'private', lifecycle: 'active' },
    { visibility: 'private', lifecycle: 'deprecated' },
    { visibility: 'private', lifecycle: 'retired' },
    { visibility: 'internal', lifecycle: 'retired' },
    { visibility: 'public', lifecycle: 'retired' },
  ] as const)(
    'an Endpoint, $visibility and $lifecycle, whose literal beats an exported param is carried, by identity and lifecycle alone',
    ({ visibility, lifecycle }) => {
      const endpoints = {
        'GET /payments/{}': exportedParam,
        'GET /payments/latest': anEndpointEntry({ visibility, lifecycle }),
      };

      const cut = exportedCutOf(aServiceSnapshot({ endpoints }), 'GET /payments/{}');

      expect(cut.shadowing).toStrictEqual({ 'GET /payments/latest': { lifecycle } });
    },
  );

  test('an exported literal that beats the exported param is carried by the param’s cut and not the reverse', () => {
    const endpoints = {
      'GET /payments/{}': exportedParam,
      'GET /payments/latest': anEndpointEntry(),
    };
    const snapshot = aServiceSnapshot({ endpoints });

    const carried = {
      byParam: exportedCutOf(snapshot, 'GET /payments/{}').shadowing,
      byLiteral: exportedCutOf(snapshot, 'GET /payments/latest').shadowing,
    };

    expect(carried).toStrictEqual({
      byParam: { 'GET /payments/latest': { lifecycle: 'active' } },
      byLiteral: {},
    });
  });

  test.each([
    ['another path', 'GET /admin/stats'],
    ['another method', 'DELETE /payments/latest'],
    ['a longer path', 'GET /payments/{}/receipt'],
    ['a shorter path', 'GET /payments'],
  ])(
    'a Private Endpoint with %s shares no URL with an exported one and is not carried',
    (_, identity) => {
      const endpoints = {
        'GET /payments/{}': exportedParam,
        [identity]: anEndpointEntry({ visibility: 'private' }),
      };

      const cut = exportedCutOf(aServiceSnapshot({ endpoints }), 'GET /payments/{}');

      expect(cut.shadowing).toStrictEqual({});
    },
  );

  test('a Private param Endpoint that an exported literal beats on every URL they share is not carried', () => {
    const endpoints = {
      'GET /payments/latest': anEndpointEntry(),
      'GET /payments/{}': anEndpointEntry({ visibility: 'private', params: ['paymentId'] }),
    };

    const cut = exportedCutOf(aServiceSnapshot({ endpoints }), 'GET /payments/latest');

    expect(cut.shadowing).toStrictEqual({});
  });

  test('a Private Endpoint that another Private one beats on the one URL it shares with an exported one is not carried', () => {
    const endpoints = {
      'GET /p/{}/b': anEndpointEntry({ params: ['paymentId'] }),
      'GET /p/a/{}': anEndpointEntry({ visibility: 'private', params: ['rest'] }),
      'GET /p/a/b': anEndpointEntry({ visibility: 'private' }),
    };

    const cut = exportedCutOf(aServiceSnapshot({ endpoints }), 'GET /p/{}/b');

    expect(Object.keys(cut.shadowing)).toEqual(['GET /p/a/b']);
  });

  test('a Private Endpoint that wins some URLs an exported one matches is carried although another beats it elsewhere', () => {
    const endpoints = {
      'GET /p/{}/{}': anEndpointEntry({ params: ['first', 'second'] }),
      'GET /p/a/{}': anEndpointEntry({ visibility: 'private', params: ['rest'] }),
      'GET /p/a/b': anEndpointEntry({ visibility: 'private' }),
    };

    const cut = exportedCutOf(aServiceSnapshot({ endpoints }), 'GET /p/{}/{}');

    expect(Object.keys(cut.shadowing)).toEqual(['GET /p/a/{}', 'GET /p/a/b']);
  });

  test('an Endpoint a published Snapshot holds only as a tombstone is never carried', () => {
    const published: PublishedServiceSnapshot = {
      ...aServiceSnapshot(),
      ...publishedAt('3.4.0'),
      commands: {},
      subscriptions: {},
      events: {},
      endpoints: {
        'GET /payments/{}': { ...exportedParam, lifecycle: 'active' },
        'GET /payments/latest': { lifecycle: 'retired', retiredIn: '3.0.0', name: 'getLatest' },
        'GET /payments/first': { ...anEndpointEntry(), lifecycle: 'retired', retiredIn: '3.1.0' },
      },
    };

    const cut = exportedCutOf(published, 'GET /payments/{}');

    expect(cut.shadowing).toStrictEqual({ 'GET /payments/first': { lifecycle: 'retired' } });
  });

  test('on every URL an exported Endpoint matches, the winner among it and its cut’s shadowing Endpoints is the winner among all declared ones', {
    timeout: 30_000,
  }, () => {
    const mismatches: string[] = [];

    for (const declared of declaredSetsOf(smallPaths, 4)) {
      const endpoints = Object.fromEntries(
        declared.map(([identity, visibility]) => [identity, anEndpointEntry({ visibility })]),
      );
      const snapshot = aServiceSnapshot({ endpoints });
      for (const [identity] of declared.filter(([, visibility]) => visibility === 'public')) {
        mismatches.push(...misroutedUrlsOf(snapshot, identity));
      }
    }

    expect(mismatches).toEqual([]);
  });

  test('the Endpoints carried keep the Snapshot’s order', () => {
    const endpoints = {
      'GET /payments/{}': exportedParam,
      'GET /payments/zeta': anEndpointEntry({ visibility: 'private' }),
      'GET /payments/alpha': anEndpointEntry({ visibility: 'private' }),
    };

    const cut = exportedCutOf(aServiceSnapshot({ endpoints }), 'GET /payments/{}');

    expect(Object.keys(cut.shadowing)).toEqual(['GET /payments/zeta', 'GET /payments/alpha']);
  });
});

/** Every path of one or two segments over two literals and a param, as an Endpoint's identity spells it. */
const smallPaths = ['a', 'b', '{}'].flatMap((first) => [
  `GET /${first}`,
  ...['a', 'b', '{}'].map((second) => `GET /${first}/${second}`),
]);

/** Every concrete URL of one or two segments over the two literals and a third text. */
const smallUrls = ['a', 'b', 'c'].flatMap((first) => [
  `/${first}`,
  ...['a', 'b', 'c'].map((second) => `/${first}/${second}`),
]);

/** Each subset of `identities` up to `size`, every member either exported or Private. */
function declaredSetsOf(
  identities: readonly string[],
  size: number,
): readonly (readonly (readonly [string, 'public' | 'private'])[])[] {
  const [first, ...rest] = identities;
  if (first === undefined || size === 0) {
    return [[]];
  }
  const without = declaredSetsOf(rest, size);
  const withFirst = declaredSetsOf(rest, size - 1);
  const exportedFirst = withFirst.map((others) => [[first, 'public'] as const, ...others]);
  const privateFirst = withFirst.map((others) => [[first, 'private'] as const, ...others]);
  return [...without, ...exportedFirst, ...privateFirst];
}

/** The URLs an exported Endpoint matches that its cut routes to another winner than all the declared Endpoints do. */
function misroutedUrlsOf(snapshot: ServiceSnapshot, identity: string): readonly string[] {
  const all = Object.keys(snapshot.endpoints).map(endpointPathOf);
  const own = endpointPathOf(identity);
  const { shadowing } = exportedCutOf(snapshot, identity);
  const routed = [own, ...all.filter((path) => path.identity in shadowing)];
  const matched = smallUrls.filter((url) => winnerAmong([own], url) !== undefined);
  const misrouted = matched.filter((url) => winnerAmong(routed, url) !== winnerAmong(all, url));
  return misrouted.map(
    (url) => `${url} through ${identity} among ${Object.keys(snapshot.endpoints)}`,
  );
}

/** The identity of the Endpoint that wins a GET of `url` among `endpoints`, or none. */
function winnerAmong(endpoints: readonly EndpointPath[], url: string): string | undefined {
  const match = matchOf(endpoints, new Request(`http://payments.test${url}`));
  return match.kind === 'matched' ? match.matched.identity : undefined;
}

/**
 * A Service whose two Public Endpoints each reach a Guard, a code and a def of their own, whose
 * Event reaches a def of its own, and whose Private Endpoint reaches one more of each.
 */
function reachingSnapshot(): ServiceSnapshot {
  const reaching = (guard: string, code: string, def: string): EndpointSnapshot => ({
    ...attaching(guard),
    rejections: [code],
    success: { status: 200, headers: noFields, body: aRef(def) },
  });
  return aServiceSnapshot({
    endpoints: {
      'GET /a': reaching('gA', codeA, 'dA'),
      'GET /b': reaching('gB', codeB, 'dB'),
      'DELETE /c': { ...reaching('gC', codeC, 'dC'), visibility: 'private' },
    },
    guards: { gA: aGuardEntry(), gB: aGuardEntry(), gC: aGuardEntry() },
    codes: { [codeA]: aCode(), [codeB]: aCode(), [codeC]: aCode() },
    events: { 'E@1': anEventEntry({ body: aRef('dE') }) },
    defs: { dA: aString, dB: aString, dC: aString, dE: aString },
  });
}

/** A Service with a Public Endpoint behind a Guard and a Private one with a code of its own. */
function declaredSnapshot(): ServiceSnapshot {
  const locked = defineRejection({ code: orderLocked, status: 409, message: 'Locked' });
  const purged = defineRejection({ code: 'PURGED', status: 410, message: 'Purged' });
  const apiKey = defineGuard({
    name: 'apiKey',
    description: 'A key per Caller',
    demands: { headers: z.object({ 'x-api-key': z.string() }) },
  });
  const getOrder = defineEndpoint({
    name: 'getOrder',
    method: 'GET',
    path: '/orders/:orderId',
    visibility: 'public',
    description: 'One order',
    guards: [apiKey],
    input: { params: z.object({ orderId: z.string() }) },
    success: { status: 200, body: z.object({ id: z.string() }) },
    rejections: [locked],
  });
  const purgeOrders = defineEndpoint({
    name: 'purgeOrders',
    method: 'DELETE',
    path: '/orders',
    visibility: 'private',
    description: 'Every order gone',
    success: { status: 204 },
    rejections: [purged],
  });
  const group = defineGroup({
    name: 'orders',
    description: 'Orders',
    endpoints: [getOrder, purgeOrders],
  });
  const root = defineService({ name: 'orders-service', groups: [group] });
  return serviceSnapshotOf(root);
}

/** A Service with a Deprecated and an Active Internal Event, and a Private one. */
function eventsSnapshot(): ServiceSnapshot {
  const placed = { name: 'OrderPlaced', visibility: 'internal', description: 'Placed' } as const;
  const events = [
    defineEvent({
      ...placed,
      version: 1,
      lifecycle: 'deprecated',
      body: z.object({ id: z.string() }),
    }),
    defineEvent({ ...placed, version: 2, body: z.object({ id: z.string(), total: z.int() }) }),
    defineEvent({
      name: 'StockReserved',
      version: 1,
      visibility: 'private',
      description: 'Stock was reserved',
      body: z.object({ sku: z.string() }),
    }),
  ] as const;
  const ordersGroup = defineGroup({ name: 'orders', description: 'Orders', events });
  const root = defineService({ name: 'orders-service', groups: [ordersGroup] });
  return serviceSnapshotOf(root);
}

/** The Snapshot of a Service's Root, the Definitions Packages it lists given resolved. */
function serviceSnapshotOf(
  root: ReturnType<typeof defineService>,
  packages: readonly ResolvedDefinitions[] = [],
): ServiceSnapshot {
  const rootPackage = aRootPackage(root, {
    packageName: 'orders-service',
    packages,
  });
  const validated = validateRoot(root, rootPackage);
  if (validated.kind !== 'valid') {
    throw new Error(`The fixture is invalid: ${JSON.stringify(validated.failures)}`);
  }
  const snapshot = snapshotOf(validated);
  if (snapshot.kind !== 'service') {
    throw new Error('The fixture is no Service');
  }
  return snapshot;
}

/**
 * A Service whose one Public Endpoint attaches an imported Definitions Package's Guard and the Guard it
 * builds on, the package's other Guard attached by none.
 */
function sharedGuardsSnapshot(): ServiceSnapshot {
  const userToken = defineGuard({ name: 'userToken', description: 'A signed-in user' });
  const permission = defineGuard({
    name: 'permission',
    description: 'The user holds a permission',
    guards: [userToken],
  });
  const unusedGuard = defineGuard({ name: 'unusedGuard', description: 'Attached by no Endpoint' });
  const definitions = defineDefinitions({});
  const getOrder = defineEndpoint({
    name: 'getOrder',
    method: 'GET',
    path: '/orders',
    visibility: 'public',
    description: 'One order',
    guards: [userToken, permission],
    success: { status: 200, body: z.object({ id: z.string() }) },
  });
  const group = defineGroup({ name: 'orders', description: 'Orders', endpoints: [getOrder] });
  const root = defineService({
    name: 'orders-service',
    groups: [group],
  });
  const packages: readonly ResolvedDefinitions[] = [
    {
      kind: 'identified',
      definitions,
      packageName: '@org/definitions',
      version: '1.0.0',
      reaches: [],
      exports: { definitions, userToken, permission, unusedGuard },
    },
  ];
  return serviceSnapshotOf(root, packages);
}

/**
 * A Service listing a Definitions Package, whose Public Endpoint lists ORDER_LOCKED and attaches a
 * chain of three Guards, only the last answering DEEP, and whose Private Endpoint lists PURGED.
 */
function codeReachSnapshot(): ServiceSnapshot {
  const locked = defineRejection({ code: orderLocked, status: 409, message: 'Locked' });
  const deep = defineRejection({ code: 'DEEP', status: 403, message: 'Deep' });
  const purged = defineRejection({ code: 'PURGED', status: 410, message: 'Purged' });
  const unused = defineRejection({ code: 'UNUSED', status: 410, message: 'Unused' });
  const inner = defineGuard({ name: 'inner', description: 'Answers DEEP', rejections: [deep] });
  const middle = defineGuard({ name: 'middle', description: 'Builds on inner', guards: [inner] });
  const outer = defineGuard({ name: 'outer', description: 'Builds on middle', guards: [middle] });
  const definitions = defineDefinitions({});
  const getOrder = defineEndpoint({
    name: 'getOrder',
    method: 'GET',
    path: '/orders',
    visibility: 'public',
    description: 'Every order',
    guards: [inner, middle, outer],
    success: { status: 200, body: z.object({ count: z.int() }) },
    rejections: [locked],
  });
  const purgeOrders = defineEndpoint({
    name: 'purgeOrders',
    method: 'DELETE',
    path: '/orders',
    visibility: 'private',
    description: 'Every order gone',
    success: { status: 204 },
    rejections: [purged],
  });
  const group = defineGroup({
    name: 'orders',
    description: 'Orders',
    endpoints: [getOrder, purgeOrders],
  });
  const root = defineService({
    name: 'orders-service',
    groups: [group],
  });
  return serviceSnapshotOf(root, [
    {
      kind: 'identified',
      definitions,
      packageName: '@org/definitions',
      version: '1.0.0',
      reaches: [],
      exports: { definitions, unused },
    },
  ]);
}
