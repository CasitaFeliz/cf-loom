import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import {
  defineContract,
  defineDefinitions,
  defineEndpoint,
  defineGroup,
  defineGuard,
  defineRejection,
} from '../index.ts';
import {
  type CodeSnapshot,
  type EndpointSnapshot,
  exportedSnapshotOf,
  type GuardSnapshot,
  type ObjectNode,
  type ResolvedDefinitions,
  type SchemaNode,
  type ServiceSnapshot,
  schemaOriginsOf,
  snapshotOf,
  validateContract,
} from '../internal/index.ts';

function aServiceSnapshot(fields: Partial<ServiceSnapshot> = {}): ServiceSnapshot {
  return {
    format: 1,
    kind: 'service',
    name: 'orders-service',
    generator: 'test',
    definitions: {},
    standardRejections: {
      invalidInput: { origin: 'cf-loom', code: 'INVALID_INPUT', status: 400, message: 'Invalid' },
      notFound: { origin: 'cf-loom', code: 'NOT_FOUND', status: 404, message: 'Not found' },
      notImplemented: { origin: 'cf-loom', code: 'NOT_IMPLEMENTED', status: 501, message: 'No' },
    },
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
    input: { params: null, query: null, headers: null, body: null },
    success: { status: 200, headers: null, body: null },
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
    demands: { headers: null, query: null },
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
    body: null,
    removed: false,
    ...fields,
  };
}

function aRef(name: string): SchemaNode {
  return { type: 'ref', name };
}

function anObjectWith(node: SchemaNode): ObjectNode {
  return { type: 'object', mode: 'strict', fields: { item: { required: true, schema: node } } };
}

const aString: SchemaNode = { type: 'string' };

/** An Endpoint's entry that attaches the Guards named, each without a Qualifier. */
function attaching(...guards: readonly string[]): EndpointSnapshot {
  return anEndpointEntry({ guards: guards.map((guard) => ({ guard, qualifier: null })) });
}

/** A code a Rejection of the Service's own answers with. */
const orderLocked = 'ORDER_LOCKED';

const privateEntry = anEndpointEntry({ name: 'purgeOrders', visibility: 'private' });

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

  test('the exported Snapshot holds format, defs, endpoints, guards and codes, nothing of the heading but format', () => {
    const snapshot = aServiceSnapshot();

    const cut = exportedSnapshotOf(snapshot);

    expect(cut).toEqual({ format: 1, defs: {}, endpoints: {}, guards: {}, codes: {} });
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
    { reach: 'only a Private Endpoint lists', entry: anEndpointEntry(), guards: {}, kept: [] },
  ])('a code $reach: the codes kept are $kept', ({ entry, guards, kept }) => {
    const purging = { ...privateEntry, rejections: [orderLocked] };
    const endpoints = { 'GET /orders': entry, 'DELETE /orders': purging };
    const codes = { [orderLocked]: aCode() };

    const cut = exportedSnapshotOf(aServiceSnapshot({ endpoints, guards, codes }));

    expect(Object.keys(cut.codes)).toEqual(kept);
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
          input: { params: anObjectWith(aRef('tree')), query: null, headers: null, body: null },
        },
      },
    ],
    [
      'input.headers',
      {
        endpoint: {
          input: { params: null, query: null, headers: anObjectWith(aRef('tree')), body: null },
        },
      },
    ],
    [
      'input.body',
      { endpoint: { input: { params: null, query: null, headers: null, body: aRef('tree') } } },
    ],
    [
      'input.query',
      {
        endpoint: {
          input: { params: null, query: anObjectWith(aRef('tree')), headers: null, body: null },
        },
      },
    ],
    [
      'success.headers',
      { endpoint: { success: { status: 200, headers: anObjectWith(aRef('tree')), body: null } } },
    ],
    ['success.body', { endpoint: { success: { status: 200, headers: null, body: aRef('tree') } } }],
    ['a Guard’s context', { guard: { context: aRef('tree') } }],
    ['a Guard’s qualifier', { guard: { qualifier: aRef('tree') } }],
    [
      'a Guard’s demands headers',
      { guard: { demands: { headers: anObjectWith(aRef('tree')), query: null } } },
    ],
    [
      'a Guard’s demands query',
      { guard: { demands: { headers: null, query: anObjectWith(aRef('tree')) } } },
    ],
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
    const endpoint = anEndpointEntry({ success: { status: 200, headers: null, body: aRef('a') } });

    const cut = exportedSnapshotOf(
      aServiceSnapshot({ endpoints: { 'GET /orders': endpoint }, defs }),
    );

    expect(cut.defs).toEqual({ a: defs.a, b: defs.b, c: defs.c });
  });

  test.each([
    {
      through: 'its own success body',
      purging: { ...privateEntry, success: { status: 200, headers: null, body: aRef('tree') } },
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
        headers: null,
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
      defs: { a: aString, z: aString },
    });

    const cut = exportedSnapshotOf(snapshot);

    expect(Object.keys(cut.endpoints)).toEqual(['GET /z', 'GET /a']);
    expect(Object.keys(cut.guards)).toEqual(['alpha', 'zeta']);
    expect(Object.keys(cut.codes)).toEqual(['A_CODE', 'Z_CODE']);
    expect(Object.keys(cut.defs)).toEqual(['a', 'z']);
  });

  test('the cut of a declared Contract keeps each exported Endpoint’s entry as the Snapshot writes it', () => {
    const snapshot = declaredSnapshot();

    const cut = exportedSnapshotOf(snapshot);

    expect(cut).toEqual({
      format: 1,
      defs: {},
      endpoints: { 'GET /orders/{}': snapshot.endpoints['GET /orders/{}'] },
      guards: { apiKey: snapshot.guards['apiKey'] },
      codes: { [orderLocked]: snapshot.codes[orderLocked] },
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
  const root = defineContract({ name: 'orders-service', groups: [group] });
  const rootPackage = {
    packageName: 'orders-service',
    originOf: () => undefined,
    exportsOf: () => [],
  };
  const validated = validateContract(root, rootPackage);
  if (validated.kind !== 'valid') {
    throw new Error(`The fixture is invalid: ${JSON.stringify(validated.failures)}`);
  }
  const snapshot = snapshotOf(validated, {
    generator: 'test',
    packages: [],
    committed: undefined,
    now: 0,
  });
  if (snapshot.kind !== 'service') {
    throw new Error('The fixture is no Service');
  }
  return snapshot;
}

/**
 * A Service whose one Public Endpoint attaches a listed Definitions Package's Guard and the Guard it
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
  const definitions = defineDefinitions({
    name: 'definitions',
    guards: [userToken, permission, unusedGuard],
  });
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
  const root = defineContract({
    name: 'orders-service',
    definitions: [definitions],
    groups: [group],
  });
  const packages: readonly ResolvedDefinitions[] = [
    { definitions, packageName: '@org/definitions', version: '1.0.0' },
  ];
  const originOf = schemaOriginsOf(packages);
  const validated = validateContract(root, {
    packageName: 'orders-service',
    originOf,
    exportsOf: () => [],
  });
  if (validated.kind !== 'valid') {
    throw new Error(`The fixture is invalid: ${JSON.stringify(validated.failures)}`);
  }
  const snapshot = snapshotOf(validated, {
    generator: 'test',
    packages,
    committed: undefined,
    now: 0,
  });
  if (snapshot.kind !== 'service') {
    throw new Error('The fixture is no Service');
  }
  return snapshot;
}
