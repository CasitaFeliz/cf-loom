import { describe, expect, test } from 'vitest';
import { schemaExports } from '../../test/snapshots.ts';
import {
  type Change,
  type ChangeSite,
  type CodeSnapshot,
  compatibilityReportOf,
  type DefinitionsSnapshot,
  type Difference,
  type Field,
  type GuardSnapshot,
  type ObjectNode,
  type PublishedDefinitionsSnapshot,
  type SchemaNode,
  type Step,
} from '../internal/index.ts';

const unauthenticated = 'UNAUTHENTICATED';
const orderLocked = 'ORDER_LOCKED';
const orderGone = 'ORDER_GONE';
const notFound = 'NOT_FOUND';
const standardRejections: DefinitionsSnapshot['standardRejections'] = {
  invalidInput: 'INVALID_INPUT',
  notFound: 'NOT_FOUND',
  notImplemented: 'NOT_IMPLEMENTED',
};

const aString: SchemaNode = { type: 'string' };

function required(schema: SchemaNode): Field {
  return { required: true, schema };
}

function optional(schema: SchemaNode): Field {
  return { required: false, schema };
}

function anOpenObject(fields: Readonly<Record<string, Field>> = {}): ObjectNode {
  return { type: 'object', fields };
}

function aDefinitions(fields: Partial<DefinitionsSnapshot> = {}): DefinitionsSnapshot {
  return {
    format: 1,
    kind: 'definitions',
    name: '@org/definitions',
    generator: '@cf-loom/cli@2.1.0',
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
  return { ...aDefinitions(), version: '4.2.0', ...fields };
}

function aGuard(fields: Partial<GuardSnapshot> = {}): GuardSnapshot {
  return {
    origin: 'local',
    description: 'Authenticates the Caller',
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
    origin: 'local',
    status: 409,
    message: 'The order is locked',
    body: null,
    removed: false,
    ...fields,
  };
}

function reportOf(baseline: PublishedDefinitionsSnapshot, proposed: DefinitionsSnapshot) {
  const report = compatibilityReportOf(baseline, proposed);
  return report;
}

function changesOf(
  baseline: PublishedDefinitionsSnapshot,
  proposed: DefinitionsSnapshot,
): readonly Change[] {
  return reportOf(baseline, proposed).changes;
}

function guardChangesOf(from: GuardSnapshot, to: GuardSnapshot): readonly Change[] {
  const baseline = aBaselineDefinitions({ guards: { authenticated: from } });
  return changesOf(baseline, aDefinitions({ guards: { authenticated: to } }));
}

function breaking(site: ChangeSite, difference: Difference): Change {
  return { site, difference, class: 'breaking', verdict: 'approval-needed' };
}

function additive(site: ChangeSite, difference: Difference): Change {
  return { site, difference, class: 'additive', verdict: 'allowed' };
}

function placeOf(site: ChangeSite): string {
  switch (site.kind) {
    case 'code':
      return site.code;
    case 'guard':
    case 'export':
    case 'subscription':
      return site.name;
    case 'endpoint':
    case 'event':
    case 'command':
      return site.identity;
  }
}

function demandAt(part: 'query' | 'headers', name: string): readonly Step[] {
  return [
    { kind: 'part', name: 'demands' },
    { kind: 'part', name: part },
    { kind: 'field', name },
  ];
}

function inputField(at: readonly Step[], isRequired: boolean): Difference {
  const shape = { kind: 'field-added', required: isRequired } as const;
  return { kind: 'schema', position: 'input', at, shape };
}

const guardSite: ChangeSite = { kind: 'guard', name: 'authenticated', visibility: 'public' };

function codeSite(code: string): ChangeSite {
  return { kind: 'code', code, visibility: 'public' };
}

describe('compatibilityReportOf, a Definitions Package’s Guards', () => {
  test('adding a Guard is Additive', () => {
    const proposed = aDefinitions({ guards: { authenticated: aGuard() } });

    const changes = changesOf(aBaselineDefinitions(), proposed);

    expect(changes).toEqual([additive(guardSite, { kind: 'added' })]);
  });

  test('removing a Guard is Breaking and needs an Approval', () => {
    const baseline = aBaselineDefinitions({ guards: { authenticated: aGuard() } });

    const changes = changesOf(baseline, aDefinitions());

    expect(changes).toEqual([breaking(guardSite, { kind: 'removed' })]);
  });

  test('renaming a Guard is a removal plus an addition', () => {
    const baseline = aBaselineDefinitions({ guards: { authenticated: aGuard() } });
    const proposed = aDefinitions({ guards: { signedIn: aGuard() } });

    const changes = changesOf(baseline, proposed);

    expect(changes).toEqual([
      breaking(guardSite, { kind: 'removed' }),
      additive({ kind: 'guard', name: 'signedIn', visibility: 'public' }, { kind: 'added' }),
    ]);
  });

  test('a required demand added to a Guard is Breaking and needs an Approval', () => {
    const query = anOpenObject({ token: required(aString) });

    const changes = guardChangesOf(aGuard(), aGuard({ demands: { headers: null, query } }));

    expect(changes).toEqual([breaking(guardSite, inputField(demandAt('query', 'token'), true))]);
  });

  test('an optional query demand added is Additive', () => {
    const query = anOpenObject({ token: optional(aString) });

    const changes = guardChangesOf(aGuard(), aGuard({ demands: { headers: null, query } }));

    expect(changes).toEqual([additive(guardSite, inputField(demandAt('query', 'token'), false))]);
  });

  test('an optional header demand with a format added is one Breaking Change, by the header text rule alone', () => {
    const at = demandAt('headers', 'x-trace');
    const traced = anOpenObject({ 'x-trace': optional({ type: 'string', format: 'uuid' }) });

    const changes = guardChangesOf(aGuard(), aGuard({ demands: { headers: traced, query: null } }));

    expect(changes).toEqual([breaking(guardSite, { kind: 'header-refuses-text', at })]);
  });

  test('an optional header demand that accepts every text added is Additive', () => {
    const at = demandAt('headers', 'x-trace');
    const traced = anOpenObject({ 'x-trace': optional(aString) });

    const changes = guardChangesOf(aGuard(), aGuard({ demands: { headers: traced, query: null } }));

    expect(changes).toEqual([additive(guardSite, inputField(at, false))]);
  });

  test('removing a demand is Additive', () => {
    const query = anOpenObject({ token: required(aString) });

    const changes = guardChangesOf(aGuard({ demands: { headers: null, query } }), aGuard());

    expect(changes).toEqual([
      additive(guardSite, {
        kind: 'schema',
        position: 'input',
        at: demandAt('query', 'token'),
        shape: { kind: 'field-removed' },
      }),
    ]);
  });

  test('demands declared where there were none compare as an open object with no fields', () => {
    const baseline = aBaselineDefinitions({ guards: { authenticated: aGuard() } });
    const empty = { headers: anOpenObject(), query: anOpenObject() };
    const proposed = aDefinitions({ guards: { authenticated: aGuard({ demands: empty }) } });

    const report = reportOf(baseline, proposed);

    expect(report).toEqual({ changes: [], hashChanged: true });
  });

  test.each([
    { name: 'gaining', from: [], to: [unauthenticated], kind: 'rejection-added' },
    { name: 'losing', from: [unauthenticated], to: [], kind: 'rejection-removed' },
  ] as const)('a Guard $name a Rejection is Additive', ({ from, to, kind }) => {
    const changes = guardChangesOf(aGuard({ rejections: from }), aGuard({ rejections: to }));

    expect(changes).toEqual([additive(guardSite, { kind, code: unauthenticated })]);
  });

  test.each([
    ['Context', { context: { type: 'object', fields: {} } }],
    ['guards', { guards: ['session'] }],
    ['qualifier', { qualifier: { type: 'string' } }],
    ['description', { description: 'Checks the session' }],
    ['origin', { origin: '@org/definitions@5.0.0#authenticated' }],
  ] as const)('a Guard’s %s changed gives no Change, only a changed hash', (_name, fields) => {
    const baseline = aBaselineDefinitions({ guards: { authenticated: aGuard() } });
    const proposed = aDefinitions({ guards: { authenticated: aGuard(fields) } });

    const report = reportOf(baseline, proposed);

    expect(report).toEqual({ changes: [], hashChanged: true });
  });

  test('a Guard’s Changes come: query, headers, then Rejections', () => {
    const query = anOpenObject({ token: required(aString) });
    const headers = anOpenObject({ 'x-trace': optional({ type: 'string', format: 'uuid' }) });
    const to = aGuard({ demands: { headers, query }, rejections: [unauthenticated] });

    const changes = guardChangesOf(aGuard(), to);

    expect(changes).toEqual([
      breaking(guardSite, inputField(demandAt('query', 'token'), true)),
      breaking(guardSite, { kind: 'header-refuses-text', at: demandAt('headers', 'x-trace') }),
      additive(guardSite, { kind: 'rejection-added', code: unauthenticated }),
    ]);
  });

  test('removing a Guard whose Rejection is declared nowhere else is Breaking on the Guard and on its code', () => {
    const baseline = aBaselineDefinitions({
      guards: { authenticated: aGuard({ rejections: [unauthenticated] }) },
      codes: { [unauthenticated]: aCode({ status: 401 }) },
    });

    const changes = changesOf(baseline, aDefinitions());

    expect(changes).toEqual([
      breaking(guardSite, { kind: 'removed' }),
      breaking(codeSite(unauthenticated), { kind: 'removed' }),
    ]);
  });
});

describe('compatibilityReportOf, a Definitions Package’s codes', () => {
  test('adding a Rejection is Additive', () => {
    const proposed = aDefinitions({ codes: { [orderLocked]: aCode() } });

    const changes = changesOf(aBaselineDefinitions(), proposed);

    expect(changes).toEqual([additive(codeSite(orderLocked), { kind: 'added' })]);
  });

  test('removing a Rejection is Breaking and needs an Approval', () => {
    const baseline = aBaselineDefinitions({ codes: { [orderLocked]: aCode() } });

    const changes = changesOf(baseline, aDefinitions());

    expect(changes).toEqual([breaking(codeSite(orderLocked), { kind: 'removed' })]);
  });

  test('the code a Standard Rejection resolved to, gone, gives no Change, and its new code is added', () => {
    const baseline = aBaselineDefinitions({
      codes: { [notFound]: aCode({ origin: 'standard', status: 404 }) },
    });
    const proposed = aDefinitions({
      standardRejections: { ...standardRejections, notFound: orderGone },
      codes: { [orderGone]: aCode({ origin: 'standard', status: 404 }) },
    });

    const changes = changesOf(baseline, proposed);

    expect(changes).toEqual([additive(codeSite(orderGone), { kind: 'added' })]);
  });

  test('a code’s status changed is Breaking on a Public code site', () => {
    const baseline = aBaselineDefinitions({ codes: { [orderLocked]: aCode({ status: 409 }) } });
    const proposed = aDefinitions({ codes: { [orderLocked]: aCode({ status: 422 }) } });

    const changes = changesOf(baseline, proposed);

    expect(changes).toEqual([
      breaking(codeSite(orderLocked), { kind: 'status-changed', from: 409, to: 422 }),
    ]);
  });

  test('a removed code not declared again is carried with no Change', () => {
    const baseline = aBaselineDefinitions({ codes: { [orderLocked]: aCode({ removed: true }) } });

    const report = reportOf(baseline, aDefinitions());

    expect(report).toEqual({ changes: [], hashChanged: false });
  });

  test('a removed code declared again is added and compared with what it last had', () => {
    const baseline = aBaselineDefinitions({
      codes: { [orderLocked]: aCode({ status: 409, removed: true }) },
    });
    const proposed = aDefinitions({ codes: { [orderLocked]: aCode({ status: 422 }) } });

    const changes = changesOf(baseline, proposed);

    expect(changes).toEqual([
      additive(codeSite(orderLocked), { kind: 'added' }),
      breaking(codeSite(orderLocked), { kind: 'status-changed', from: 409, to: 422 }),
    ]);
  });

  test('a Standard Rejection resolving to a code a user Rejection once used is added and compared with what it last had', () => {
    const baseline = aBaselineDefinitions({
      codes: {
        [notFound]: aCode({ origin: 'standard', status: 404 }),
        [orderGone]: aCode({ status: 409, removed: true }),
      },
    });
    const proposed = aDefinitions({
      standardRejections: { ...standardRejections, notFound: orderGone },
      codes: { [orderGone]: aCode({ origin: 'standard', status: 404 }) },
    });

    const changes = changesOf(baseline, proposed);

    expect(changes).toEqual([
      additive(codeSite(orderGone), { kind: 'added' }),
      breaking(codeSite(orderGone), { kind: 'status-changed', from: 409, to: 404 }),
    ]);
  });

  test('dropping a user Rejection and making a Standard Rejection resolve to its code gives no presence Change', () => {
    const baseline = aBaselineDefinitions({
      codes: {
        [notFound]: aCode({ origin: 'standard', status: 404 }),
        [orderGone]: aCode({ status: 404 }),
      },
    });
    const proposed = aDefinitions({
      standardRejections: { ...standardRejections, notFound: orderGone },
      codes: { [orderGone]: aCode({ origin: 'standard', status: 404 }) },
    });

    const changes = changesOf(baseline, proposed);

    expect(changes).toEqual([]);
  });

  test('a Definitions Package’s Changes come: shared schemas, then Guards, then codes by code in code point order', () => {
    const proposed = aDefinitions({
      exports: schemaExports({ money: anOpenObject() }),
      guards: { authenticated: aGuard() },
      codes: { [orderLocked]: aCode(), [orderGone]: aCode() },
    });

    const changes = changesOf(aBaselineDefinitions(), proposed);

    expect(changes.map(({ site }) => [site.kind, placeOf(site)])).toEqual([
      ['export', 'money'],
      ['guard', 'authenticated'],
      ['code', orderGone],
      ['code', orderLocked],
    ]);
  });
});
