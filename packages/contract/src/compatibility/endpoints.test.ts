import { describe, expect, test } from 'vitest';
import {
  type Change,
  type ChangeSite,
  type CodeSnapshot,
  compatibilityReportOf,
  type Difference,
  type EndpointSnapshot,
  type Field,
  type GuardSnapshot,
  type ObjectNode,
  type PublishedServiceSnapshot,
  type SchemaNode,
  type ServiceSnapshot,
  type ShapeDifference,
  type Step,
  snapshotPathOf,
} from '../internal/index.ts';

type Visibility = EndpointSnapshot['visibility'];
type Input = EndpointSnapshot['input'];
type Success = EndpointSnapshot['success'];

const identity = 'PUT /orders/{}';
const orderLocked = 'ORDER_LOCKED';
const standardRejections: ServiceSnapshot['standardRejections'] = {
  invalidInput: 'INVALID_INPUT',
  notFound: 'NOT_FOUND',
  notImplemented: 'NOT_IMPLEMENTED',
};
const heading = {
  format: 1,
  kind: 'service',
  name: 'orders-service',
  generator: '@cf-loom/cli@2.1.0',
  standardRejections,
  defs: {},
  guards: {},
  codes: {},
  events: {},
  commands: {},
  subscriptions: {},
  dependencies: {},
} as const;

const aString: SchemaNode = { type: 'string' };
const aNumber: SchemaNode = { type: 'number' };

function required(schema: SchemaNode): Field {
  return { required: true, schema };
}

function optional(schema: SchemaNode): Field {
  return { required: false, schema };
}

function anOpenObject(fields: Readonly<Record<string, Field>> = {}): ObjectNode {
  return { type: 'object', fields };
}

function theParams(...fields: readonly (readonly [string, SchemaNode])[]): ObjectNode {
  const entries = fields.map(([name, schema]) => [name, required(schema)]);
  return { type: 'object', fields: Object.fromEntries(entries) };
}

function anInput(fields: Partial<Input> = {}): Input {
  return {
    params: theParams(['orderId', aString]),
    query: { type: 'object', fields: {} },
    headers: { type: 'object', fields: {} },
    body: null,
    ...fields,
  };
}

function aSuccess(fields: Partial<Success> = {}): Success {
  return { status: 200, headers: { type: 'object', fields: {} }, body: null, ...fields };
}

function anEndpoint(fields: Partial<EndpointSnapshot> = {}): EndpointSnapshot {
  return {
    name: 'updateOrder',
    group: 'orders',
    visibility: 'public',
    lifecycle: 'active',
    description: 'Updates an order',
    params: ['orderId'],
    guards: [],
    input: anInput(),
    success: aSuccess(),
    rejections: [],
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

function aBaseline(
  endpoint: EndpointSnapshot,
  fields: Partial<PublishedServiceSnapshot> = {},
): PublishedServiceSnapshot {
  const live = { ...endpoint, lifecycle: 'active' } as const;
  return { ...heading, version: '3.4.0', endpoints: { [identity]: live }, ...fields };
}

function aProposed(
  endpoint: EndpointSnapshot,
  fields: Partial<ServiceSnapshot> = {},
): ServiceSnapshot {
  return { ...heading, endpoints: { [identity]: endpoint }, ...fields };
}

function reportOf(baseline: PublishedServiceSnapshot, proposed: ServiceSnapshot) {
  const report = compatibilityReportOf(baseline, proposed);
  return report;
}

function changesOf(from: EndpointSnapshot, to: EndpointSnapshot): readonly Change[] {
  return reportOf(aBaseline(from), aProposed(to)).changes;
}

const site: ChangeSite = { kind: 'endpoint', identity, name: 'updateOrder', visibility: 'public' };

function breaking(difference: Difference): Change {
  return { site, difference, class: 'breaking', verdict: 'approval-needed' };
}

function additive(difference: Difference): Change {
  return { site, difference, class: 'additive', verdict: 'allowed' };
}

function neutral(difference: Difference): Change {
  return { site, difference, class: 'neutral', verdict: 'allowed' };
}

const attachmentsChanged = neutral({ kind: 'attachments-changed' });

type Part = Extract<Step, { readonly kind: 'part' }>['name'];

function partsAt(...names: readonly Part[]): readonly Step[] {
  return names.map((name) => ({ kind: 'part', name }));
}

function fieldAt(parts: readonly Part[], name: string): readonly Step[] {
  return [...partsAt(...parts), { kind: 'field', name }];
}

function schemaChange(
  at: readonly Step[],
  shape: ShapeDifference,
  position: 'input' | 'success' = 'input',
) {
  return { kind: 'schema', position, at, shape } as const;
}

function fieldAdded(
  at: readonly Step[],
  isRequired: boolean,
  position: 'input' | 'success' = 'input',
) {
  return schemaChange(at, { kind: 'field-added', required: isRequired }, position);
}

const typeChange = { kind: 'type-changed', from: 'string', to: 'number' } as const;
const unprovenParam = { kind: 'unproven', node: 'param' } as const;

describe('compatibilityReportOf, path params', () => {
  test.each(['public', 'internal', 'private'] as const)(
    'renaming a path param is Additive on a %s Endpoint',
    (visibility: Visibility) => {
      const from = anEndpoint({ visibility });
      const to = anEndpoint({
        visibility,
        params: ['id'],
        input: anInput({ params: theParams(['id', aString]) }),
      });

      const changes = changesOf(from, to);

      expect(changes).toEqual([
        {
          site: { ...site, visibility },
          difference: { kind: 'param-renamed', from: 'orderId', to: 'id' },
          class: 'additive',
          verdict: 'allowed',
        },
      ]);
    },
  );

  test('a path param’s type change is Breaking, found at its proposed name', () => {
    const to = anEndpoint({ input: anInput({ params: theParams(['orderId', aNumber]) }) });

    const changes = changesOf(anEndpoint(), to);

    expect(changes).toEqual([
      breaking(schemaChange(fieldAt(['input', 'params'], 'orderId'), typeChange)),
    ]);
  });

  test('a path param renamed and retyped gives a rename and a type change', () => {
    const to = anEndpoint({
      params: ['id'],
      input: anInput({ params: theParams(['id', aNumber]) }),
    });

    const changes = changesOf(anEndpoint(), to);

    expect(changes).toEqual([
      additive({ kind: 'param-renamed', from: 'orderId', to: 'id' }),
      breaking(schemaChange(fieldAt(['input', 'params'], 'id'), typeChange)),
    ]);
  });

  test('params are matched by position, not by the order of the params object’s keys', () => {
    const from = anEndpoint({
      params: ['a', 'b'],
      input: anInput({ params: theParams(['a', aString], ['b', aNumber]) }),
    });
    const swapped = anEndpoint({
      params: ['b', 'a'],
      input: anInput({ params: theParams(['b', aNumber], ['a', aString]) }),
    });

    const changes = changesOf(from, swapped);

    expect(changes).toEqual([
      additive({ kind: 'param-renamed', from: 'a', to: 'b' }),
      breaking(schemaChange(fieldAt(['input', 'params'], 'b'), typeChange)),
      additive({ kind: 'param-renamed', from: 'b', to: 'a' }),
      breaking(
        schemaChange(fieldAt(['input', 'params'], 'a'), {
          kind: 'type-changed',
          from: 'number',
          to: 'string',
        }),
      ),
    ]);
  });

  test('tightening a path param’s constraint is Breaking', () => {
    const from = anEndpoint({ input: anInput({ params: theParams(['orderId', aString]) }) });
    const to = anEndpoint({
      input: anInput({ params: theParams(['orderId', { type: 'string', min: 3 }]) }),
    });

    const changes = changesOf(from, to);

    expect(changes).toEqual([
      breaking(
        schemaChange(fieldAt(['input', 'params'], 'orderId'), {
          kind: 'constraint-tightened',
          constraint: 'lower-bound',
        }),
      ),
    ]);
  });

  test('relaxing a path param’s constraint is Additive', () => {
    const from = anEndpoint({
      input: anInput({ params: theParams(['orderId', { type: 'string', min: 3 }]) }),
    });

    const changes = changesOf(from, anEndpoint());

    expect(changes).toEqual([
      additive(
        schemaChange(fieldAt(['input', 'params'], 'orderId'), {
          kind: 'constraint-relaxed',
          constraint: 'lower-bound',
        }),
      ),
    ]);
  });

  test('a path param with no schema in the Baseline is Breaking: nothing proves it compatible', () => {
    const corrupted = anEndpoint({ input: anInput({ params: theParams(['id', aString]) }) });

    const changes = changesOf(corrupted, anEndpoint());

    expect(changes).toEqual([
      breaking(schemaChange(fieldAt(['input', 'params'], 'orderId'), unprovenParam)),
    ]);
  });

  test('a path param named where the Baseline declares no params is Breaking', () => {
    const corrupted = anEndpoint({ input: anInput({ params: null }) });

    const changes = changesOf(corrupted, anEndpoint());

    expect(changes).toEqual([
      breaking(schemaChange(fieldAt(['input', 'params'], 'orderId'), unprovenParam)),
    ]);
  });

  test('a path param named constructor that one side holds no schema for is Breaking', () => {
    const named = anEndpoint({
      params: ['constructor'],
      input: anInput({ params: theParams(['constructor', aString]) }),
    });
    const corrupted = anEndpoint({
      params: ['constructor'],
      input: anInput({ params: theParams(['id', aString]) }),
    });

    const changes = changesOf(corrupted, named);

    expect(changes).toEqual([
      breaking(schemaChange(fieldAt(['input', 'params'], 'constructor'), unprovenParam)),
    ]);
  });

  test('a renamed path param with no schema in the proposed Snapshot gives a rename and a Breaking Change', () => {
    const corrupted = anEndpoint({
      params: ['id'],
      input: anInput({ params: theParams(['orderId', aString]) }),
    });

    const changes = changesOf(anEndpoint(), corrupted);

    expect(changes).toEqual([
      additive({ kind: 'param-renamed', from: 'orderId', to: 'id' }),
      breaking(schemaChange(fieldAt(['input', 'params'], 'id'), unprovenParam)),
    ]);
  });

  test('adding a path param moves the Endpoint: an added Endpoint and a deletion', () => {
    const moved = aProposed(anEndpoint(), {
      endpoints: {
        'PUT /orders/{}/items/{}': anEndpoint({
          params: ['orderId', 'itemId'],
          input: anInput({ params: theParams(['orderId', aString], ['itemId', aString]) }),
        }),
      },
    });

    const report = reportOf(aBaseline(anEndpoint()), moved);

    expect(report.changes.map(({ site: where, difference }) => [where, difference.kind])).toEqual([
      [site, 'deleted'],
      [{ ...site, identity: 'PUT /orders/{}/items/{}' }, 'added'],
    ]);
  });
});

describe('compatibilityReportOf, query', () => {
  const queryOf = (fields: Readonly<Record<string, Field>>) =>
    anEndpoint({ input: anInput({ query: anOpenObject(fields) }) });
  const pageAt = fieldAt(['input', 'query'], 'page');

  test('adding an optional query param is Additive', () => {
    const changes = changesOf(queryOf({}), queryOf({ page: optional(aNumber) }));

    expect(changes).toEqual([additive(fieldAdded(pageAt, false))]);
  });

  test('adding a required query param is Breaking', () => {
    const changes = changesOf(queryOf({}), queryOf({ page: required(aNumber) }));

    expect(changes).toEqual([breaking(fieldAdded(pageAt, true))]);
  });

  test('removing a query param is Additive', () => {
    const changes = changesOf(queryOf({ page: required(aNumber) }), queryOf({}));

    expect(changes).toEqual([additive(schemaChange(pageAt, { kind: 'field-removed' }))]);
  });

  test('a query param turned from a single value into a list is a type change, Breaking', () => {
    const list: SchemaNode = { type: 'array', items: aNumber };

    const changes = changesOf(
      queryOf({ page: required(aNumber) }),
      queryOf({ page: required(list) }),
    );

    expect(changes).toEqual([
      breaking(schemaChange(pageAt, { kind: 'type-changed', from: 'number', to: 'array' })),
    ]);
  });

  test('a query declared with an optional field where there was none gives that field added', () => {
    const changes = changesOf(anEndpoint(), queryOf({ page: optional(aNumber) }));

    expect(changes).toEqual([additive(fieldAdded(pageAt, false))]);
  });

  test('a query dropped where there was one gives its fields removed', () => {
    const changes = changesOf(queryOf({ page: optional(aNumber) }), anEndpoint());

    expect(changes).toEqual([additive(schemaChange(pageAt, { kind: 'field-removed' }))]);
  });

  test('attaching a Guard that demands a required query param is Breaking', () => {
    const attached = anEndpoint({
      guards: [{ guard: 'authenticated', qualifier: null }],
      input: anInput({ query: anOpenObject({ token: required(aString) }) }),
    });
    const demanding = aGuard({
      demands: {
        headers: { type: 'object', fields: {} },
        query: anOpenObject({ token: required(aString) }),
      },
    });

    const report = reportOf(
      aBaseline(anEndpoint()),
      aProposed(attached, { guards: { authenticated: demanding } }),
    );

    expect(report.changes).toEqual([
      breaking(fieldAdded(fieldAt(['input', 'query'], 'token'), true)),
      attachmentsChanged,
    ]);
  });
});

describe('compatibilityReportOf, Input headers', () => {
  const headersOf = (fields: Readonly<Record<string, Field>>) =>
    anEndpoint({ input: anInput({ headers: anOpenObject(fields) }) });
  const traceAt = fieldAt(['input', 'headers'], 'x-trace');
  const refusesText = { kind: 'header-refuses-text', at: traceAt } as const;

  const accepting: readonly (readonly [string, SchemaNode])[] = [
    ['a string with no constraint', aString],
    ['a nullable string', { type: 'string', nullable: true }],
    ['a string with only a description', { type: 'string', description: 'A trace id' }],
  ];

  test.each(accepting)('adding an optional header of %s is Additive', (_name, schema) => {
    const changes = changesOf(headersOf({}), headersOf({ 'x-trace': optional(schema) }));

    expect(changes).toEqual([additive(fieldAdded(traceAt, false))]);
  });

  const refusing: readonly (readonly [string, SchemaNode])[] = [
    ['a format', { type: 'string', format: 'uuid' }],
    ['a regex', { type: 'string', regex: { source: '^[a-z]+$', flags: '' } }],
    ['a min length', { type: 'string', min: 1 }],
    ['a max length', { type: 'string', max: 64 }],
    ['an enum', { type: 'enum', values: ['a', 'b'], open: false }],
    ['a number', aNumber],
    ['a boolean', { type: 'boolean' }],
  ];

  test.each(refusing)(
    'adding an optional header with %s is one Breaking Change, by the header text rule alone',
    (_name, schema) => {
      const changes = changesOf(headersOf({}), headersOf({ 'x-trace': optional(schema) }));

      expect(changes).toEqual([breaking(refusesText)]);
    },
  );

  test('adding a required header is one Breaking Change, by the field rules', () => {
    const changes = changesOf(headersOf({}), headersOf({ 'x-trace': required(aNumber) }));

    expect(changes).toEqual([breaking(fieldAdded(traceAt, true))]);
  });

  test('narrowing an existing header is a schema Change, not the header text rule', () => {
    const narrowed: SchemaNode = { type: 'enum', values: ['a'], open: false };

    const changes = changesOf(
      headersOf({ 'x-trace': optional(aString) }),
      headersOf({ 'x-trace': optional(narrowed) }),
    );

    expect(changes).toEqual([
      breaking(schemaChange(traceAt, { kind: 'enum-narrowed', from: 'string' })),
    ]);
  });

  test('attaching a Guard that demands an optional header with an enum is one Breaking Change', () => {
    const closedEnum: SchemaNode = { type: 'enum', values: ['a', 'b'], open: false };
    const attached = anEndpoint({
      guards: [{ guard: 'traced', qualifier: null }],
      input: anInput({ headers: anOpenObject({ 'x-trace': optional(closedEnum) }) }),
    });
    const demanding = aGuard({
      demands: {
        query: { type: 'object', fields: {} },
        headers: anOpenObject({ 'x-trace': optional(closedEnum) }),
      },
    });

    const report = reportOf(
      aBaseline(anEndpoint()),
      aProposed(attached, { guards: { traced: demanding } }),
    );

    expect(report.changes).toEqual([breaking(refusesText), attachmentsChanged]);
  });

  test('attaching a Guard that demands a required header is Breaking', () => {
    const attached = anEndpoint({
      guards: [{ guard: 'authenticated', qualifier: null }],
      input: anInput({ headers: anOpenObject({ authorization: required(aString) }) }),
    });

    const report = reportOf(aBaseline(anEndpoint()), aProposed(attached));

    expect(report.changes).toEqual([
      breaking(fieldAdded(fieldAt(['input', 'headers'], 'authorization'), true)),
      attachmentsChanged,
    ]);
  });

  test('detaching a Guard drops its demands, Additive', () => {
    const attached = anEndpoint({
      guards: [{ guard: 'authenticated', qualifier: null }],
      input: anInput({ headers: anOpenObject({ authorization: required(aString) }) }),
    });

    const changes = changesOf(attached, anEndpoint());

    expect(changes).toEqual([
      additive(
        schemaChange(fieldAt(['input', 'headers'], 'authorization'), { kind: 'field-removed' }),
      ),
      attachmentsChanged,
    ]);
  });

  test('moving a header’s declaration from the Endpoint to a Guard gives only attachments-changed', () => {
    const headers = anOpenObject({ authorization: required(aString) });
    const own = anEndpoint({ input: anInput({ headers }) });
    const throughGuard = anEndpoint({
      guards: [{ guard: 'authenticated', qualifier: null }],
      input: anInput({ headers }),
    });

    const report = reportOf(aBaseline(own), aProposed(throughGuard));

    expect(report.changes).toEqual([attachmentsChanged]);
  });

  test('removing a header is Additive', () => {
    const changes = changesOf(headersOf({ 'x-trace': required(aString) }), headersOf({}));

    expect(changes).toEqual([additive(schemaChange(traceAt, { kind: 'field-removed' }))]);
  });
});

describe('compatibilityReportOf, bodies and Success', () => {
  const body = anOpenObject({ note: required(aString) });

  test('changing the Success status is Breaking and needs an Approval', () => {
    const to = anEndpoint({ success: aSuccess({ status: 201 }) });

    const changes = changesOf(anEndpoint(), to);

    expect(changes).toEqual([breaking({ kind: 'status-changed', from: 200, to: 201 })]);
  });

  test.each([
    ['added', anEndpoint(), anEndpoint({ success: aSuccess({ body }) })],
    ['removed', anEndpoint({ success: aSuccess({ body }) }), anEndpoint()],
  ] as const)('a Success body %s is Breaking', (change, from, to) => {
    const changes = changesOf(from, to);

    expect(changes).toEqual([
      breaking({ kind: `body-${change}`, at: partsAt('success', 'body'), position: 'success' }),
    ]);
  });

  test('an Input body added is Breaking', () => {
    const to = anEndpoint({ input: anInput({ body }) });

    const changes = changesOf(anEndpoint(), to);

    expect(changes).toEqual([
      breaking({ kind: 'body-added', at: partsAt('input', 'body'), position: 'input' }),
    ]);
  });

  test('an Input body added with every field optional is still Breaking: a Caller that sends none is refused', () => {
    const allOptional = anOpenObject({ note: optional(aString) });
    const to = anEndpoint({ input: anInput({ body: allOptional }) });

    const changes = changesOf(anEndpoint(), to);

    expect(changes).toEqual([
      breaking({ kind: 'body-added', at: partsAt('input', 'body'), position: 'input' }),
    ]);
  });

  test('an Input body removed is Additive', () => {
    const from = anEndpoint({ input: anInput({ body }) });

    const changes = changesOf(from, anEndpoint());

    expect(changes).toEqual([
      additive({ kind: 'body-removed', at: partsAt('input', 'body'), position: 'input' }),
    ]);
  });

  test('a body declared on both sides is compared by its schema', () => {
    const from = anEndpoint({ input: anInput({ body }) });
    const to = anEndpoint({ input: anInput({ body: anOpenObject({ note: required(aNumber) }) }) });

    const changes = changesOf(from, to);

    expect(changes).toEqual([
      breaking(schemaChange(fieldAt(['input', 'body'], 'note'), typeChange)),
    ]);
  });

  test('a 204 that gains a body gives a status change and a body added', () => {
    const from = anEndpoint({ success: aSuccess({ status: 204 }) });
    const to = anEndpoint({ success: aSuccess({ status: 200, body }) });

    const changes = changesOf(from, to);

    expect(changes).toEqual([
      breaking({ kind: 'status-changed', from: 204, to: 200 }),
      breaking({ kind: 'body-added', at: partsAt('success', 'body'), position: 'success' }),
    ]);
  });

  const headersOf = (fields: Readonly<Record<string, Field>>) =>
    anEndpoint({ success: aSuccess({ headers: anOpenObject(fields) }) });
  const locationAt = fieldAt(['success', 'headers'], 'location');

  test('adding a Success header is Additive, even with a format', () => {
    const withFormat: SchemaNode = { type: 'string', format: 'uuid' };

    const changes = changesOf(headersOf({}), headersOf({ location: optional(withFormat) }));

    expect(changes).toEqual([additive(fieldAdded(locationAt, false, 'success'))]);
  });

  test('removing a Success header is Breaking', () => {
    const changes = changesOf(headersOf({ location: required(aString) }), headersOf({}));

    expect(changes).toEqual([
      breaking(schemaChange(locationAt, { kind: 'field-removed' }, 'success')),
    ]);
  });

  test('making a Success header optional is Breaking', () => {
    const changes = changesOf(
      headersOf({ location: required(aString) }),
      headersOf({ location: optional(aString) }),
    );

    expect(changes).toEqual([
      breaking(schemaChange(locationAt, { kind: 'field-made-optional' }, 'success')),
    ]);
  });

  test('Success headers declared with a required field where there were none give that field added', () => {
    const changes = changesOf(anEndpoint(), headersOf({ location: required(aString) }));

    expect(changes).toEqual([additive(fieldAdded(locationAt, true, 'success'))]);
  });
});

describe('compatibilityReportOf, an Endpoint’s Rejections', () => {
  const rejecting = (...codes: readonly string[]) => anEndpoint({ rejections: codes });

  test('adding a Rejection to an Endpoint is Additive', () => {
    const changes = changesOf(rejecting('ORDER_LOCKED'), rejecting('ORDER_LOCKED', 'NOT_FOUND'));

    expect(changes).toEqual([additive({ kind: 'rejection-added', code: 'NOT_FOUND' })]);
  });

  test('removing a Rejection from an Endpoint is Additive', () => {
    const changes = changesOf(rejecting('NOT_FOUND', 'ORDER_LOCKED'), rejecting('NOT_FOUND'));

    expect(changes).toEqual([additive({ kind: 'rejection-removed', code: 'ORDER_LOCKED' })]);
  });

  test('renaming a code is a removal plus an addition, by code in code point order', () => {
    const changes = changesOf(rejecting('ORDER_LOCKED'), rejecting('ORDER_FROZEN'));

    expect(changes).toEqual([
      additive({ kind: 'rejection-added', code: 'ORDER_FROZEN' }),
      additive({ kind: 'rejection-removed', code: 'ORDER_LOCKED' }),
    ]);
  });

  test('a Guard gaining a Rejection is Additive on each Endpoint that attaches it', () => {
    const guarded = anEndpoint({ guards: [{ guard: 'authenticated', qualifier: null }] });
    const gained = anEndpoint({ ...guarded, rejections: ['TOKEN_EXPIRED'] });
    const other = 'GET /orders/{}/audit';
    const baseline = aBaseline(guarded, { endpoints: endpointsOf(guarded, other) });
    const proposed = aProposed(gained, { endpoints: endpointsOf(gained, other) });

    const report = reportOf(baseline, proposed);

    expect(report.changes).toEqual([
      { ...additive({ kind: 'rejection-added', code: 'TOKEN_EXPIRED' }), site: auditSite(other) },
      additive({ kind: 'rejection-added', code: 'TOKEN_EXPIRED' }),
    ]);
  });

  test('attaching a Guard adds its Rejections, Additive', () => {
    const attached = anEndpoint({
      guards: [{ guard: 'authenticated', qualifier: null }],
      rejections: ['UNAUTHENTICATED'],
    });

    const changes = changesOf(anEndpoint(), attached);

    expect(changes).toEqual([
      additive({ kind: 'rejection-added', code: 'UNAUTHENTICATED' }),
      attachmentsChanged,
    ]);
  });
});

function endpointsOf(endpoint: EndpointSnapshot, other: string) {
  const live = { ...endpoint, lifecycle: 'active' } as const;
  return { [identity]: live, [other]: { ...live, name: 'auditOrder' } };
}

function auditSite(other: string): ChangeSite {
  return { kind: 'endpoint', identity: other, name: 'auditOrder', visibility: 'public' };
}

describe('compatibilityReportOf, Neutral', () => {
  const guards = [
    { guard: 'authenticated', qualifier: null },
    { guard: 'traced', qualifier: null },
  ];
  const attached = anEndpoint({ guards });
  const codeSite: ChangeSite = { kind: 'code', code: orderLocked, visibility: 'public' };
  const neutralRows: readonly {
    readonly name: string;
    readonly baseline: PublishedServiceSnapshot;
    readonly proposed: ServiceSnapshot;
    readonly expected: readonly Change[];
  }[] = [
    {
      name: 'moving an Endpoint to another Group',
      baseline: aBaseline(anEndpoint()),
      proposed: aProposed(anEndpoint({ group: 'archive' })),
      expected: [neutral({ kind: 'group-changed', from: 'orders', to: 'archive' })],
    },
    {
      name: 'reordering an Endpoint’s Guards',
      baseline: aBaseline(attached),
      proposed: aProposed(anEndpoint({ guards: [...guards].reverse() })),
      expected: [attachmentsChanged],
    },
    {
      name: 'changing an Attachment’s Qualifier',
      baseline: aBaseline(anEndpoint({ guards: [{ guard: 'roles', qualifier: ['admin'] }] })),
      proposed: aProposed(
        anEndpoint({ guards: [{ guard: 'roles', qualifier: ['admin', 'agent'] }] }),
      ),
      expected: [attachmentsChanged],
    },
    {
      name: 'changing a Rejection’s message',
      baseline: aBaseline(anEndpoint({ rejections: [orderLocked] }), {
        codes: { [orderLocked]: aCode('Locked') },
      }),
      proposed: aProposed(anEndpoint({ rejections: [orderLocked] }), {
        codes: { [orderLocked]: aCode('Frozen') },
      }),
      expected: [
        {
          site: codeSite,
          difference: { kind: 'message-changed' },
          class: 'neutral',
          verdict: 'allowed',
        },
      ],
    },
  ];

  test.each(neutralRows)('$name is one Neutral Change', ({ baseline, proposed, expected }) => {
    const report = reportOf(baseline, proposed);

    expect(report.changes).toEqual(expected);
  });
});

function aCode(message: string): CodeSnapshot {
  return { origin: 'local', status: 409, message, body: null, removed: false };
}

describe('compatibilityReportOf, an Endpoint’s order', () => {
  test('an Endpoint’s Changes come: lifecycle, Visibility, rename, params, query, headers, Input body, Success status, headers and body, Rejections', () => {
    const from = anEndpoint({
      visibility: 'internal',
      lifecycle: 'active',
      input: anInput({ query: anOpenObject({}), headers: anOpenObject({}) }),
      success: aSuccess({ headers: anOpenObject({}), body: anOpenObject({}) }),
    });
    const to = anEndpoint({
      name: 'changeOrder',
      visibility: 'public',
      lifecycle: 'deprecated',
      params: ['id'],
      input: anInput({
        params: theParams(['id', aString]),
        query: anOpenObject({ page: optional(aNumber) }),
        headers: anOpenObject({ 'x-trace': optional(aNumber) }),
        body: anOpenObject({}),
      }),
      success: aSuccess({
        status: 201,
        headers: anOpenObject({ location: required(aString) }),
        body: anOpenObject({ id: required(aString) }),
      }),
      rejections: ['ORDER_LOCKED'],
    });

    const changes = changesOf(from, to);

    expect(changes.map(({ difference }) => describedAs(difference))).toEqual([
      'deprecated',
      'visibility-widened',
      'renamed',
      'param-renamed',
      'input.query.fields.page',
      'header-refuses-text',
      'body-added input.body',
      'status-changed',
      'success.headers.fields.location',
      'success.body.fields.id',
      'rejection-added',
    ]);
  });

  test('the Input body comes before the Success body', () => {
    const body = anOpenObject({});
    const to = anEndpoint({ input: anInput({ body }), success: aSuccess({ body }) });

    const changes = changesOf(anEndpoint(), to);

    expect(changes.map(({ difference }) => describedAs(difference))).toEqual([
      'body-added input.body',
      'body-added success.body',
    ]);
  });
});

function describedAs(difference: Difference): string {
  switch (difference.kind) {
    case 'schema':
      return snapshotPathOf(difference.at).join('.');
    case 'body-added':
    case 'body-removed':
      return `${difference.kind} ${snapshotPathOf(difference.at).join('.')}`;
    default:
      return difference.kind;
  }
}

describe('compatibilityReportOf, retiring an Endpoint compares nothing it declares', () => {
  const deprecated = anEndpoint({ lifecycle: 'deprecated' });
  const locked: CodeSnapshot = {
    origin: 'local',
    status: 409,
    message: 'Locked',
    body: null,
    removed: false,
  };

  function retiringChangesOf(retired: EndpointSnapshot): readonly Change[] {
    const baseline: PublishedServiceSnapshot = {
      ...heading,
      version: '3.4.0',
      endpoints: { [identity]: { ...deprecated, lifecycle: 'deprecated' } },
      codes: { [orderLocked]: locked },
    };
    const proposed = aProposed({ ...retired, lifecycle: 'retired' }, { codes: baseline.codes });
    return reportOf(baseline, proposed).changes;
  }

  const body = anOpenObject({ note: required(aString) });
  const header = anOpenObject({ 'x-trace': required(aString) });
  test.each<[string, Partial<EndpointSnapshot>]>([
    ['a Success whose status changed', { success: aSuccess({ status: 201 }) }],
    ['a Success body added', { success: aSuccess({ body }) }],
    ['an Input body added', { input: anInput({ body }) }],
    ['an Input header added', { input: anInput({ headers: header }) }],
    ['a query param added', { input: anInput({ query: header }) }],
    [
      'a path param whose type changed',
      { input: anInput({ params: theParams(['orderId', aNumber]) }) },
    ],
    ['a code answered that was not', { rejections: [orderLocked] }],
  ])(
    'retiring a Deprecated Endpoint with %s compares nothing but reports retired-changed',
    (_name, change) => {
      const changes = retiringChangesOf({ ...deprecated, ...change });

      expect(changes.map(({ difference }) => difference.kind)).toEqual([
        'retired',
        'retired-changed',
      ]);
    },
  );

  test('an Endpoint still declared Deprecated with a changed Success reports it', () => {
    const baseline: PublishedServiceSnapshot = {
      ...heading,
      version: '3.4.0',
      endpoints: { [identity]: { ...deprecated, lifecycle: 'deprecated' } },
    };
    const proposed = aProposed({ ...deprecated, success: aSuccess({ status: 201 }) });

    const changes = reportOf(baseline, proposed).changes;

    expect(changes.map(({ difference }) => difference.kind)).toEqual(['status-changed']);
  });
});
