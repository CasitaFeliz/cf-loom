import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { publishedBy, schemaExports } from '../../test/snapshots.ts';
import {
  type Change,
  type ChangeSite,
  compatibilityReportOf,
  type DefinitionsSnapshot,
  type Difference,
  decodeSnapshot,
  type Field,
  type GuardSnapshot,
  type ObjectNode,
  type PublishedCode,
  type PublishedDefinitionsSnapshot,
  type RemovedCode,
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

function aCode(fields: Partial<PublishedCode> = {}): PublishedCode {
  return {
    origin: 'local',
    status: 409,
    message: 'The order is locked',
    headers: { type: 'object', fields: {} },
    body: null,
    ...fields,
  };
}

function aRemovedCode(fields: Partial<RemovedCode> = {}): RemovedCode {
  return { ...aCode(), removedIn: '3.2.0', defs: {}, ...fields };
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

function neutral(site: ChangeSite, difference: Difference): Change {
  return { site, difference, class: 'neutral', verdict: 'allowed' };
}

function additive(site: ChangeSite, difference: Difference): Change {
  return { site, difference, class: 'additive', verdict: 'allowed' };
}

function placeOf(site: ChangeSite): string {
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

const standardSite: ChangeSite = {
  kind: 'standard-rejection',
  name: 'notFound',
  visibility: 'public',
};
const guardSite: ChangeSite = { kind: 'guard', name: 'authenticated', visibility: 'public' };

function codeSite(code: string): ChangeSite {
  return { kind: 'code', code, visibility: 'public' };
}

function exportSite(name: string): ChangeSite {
  return { kind: 'export', name, visibility: 'public' };
}

/** The exports naming a Guard, each under the Guard's own name. */
function guardExports(...guards: readonly string[]): DefinitionsSnapshot['exports'] {
  return Object.fromEntries(guards.map((guard) => [guard, { kind: 'guard', guard }]));
}

/** The exports naming a Rejection, each under its code. */
function rejectionExports(...codes: readonly string[]): DefinitionsSnapshot['exports'] {
  return Object.fromEntries(codes.map((code) => [code, { kind: 'rejection', code }]));
}

describe('compatibilityReportOf, a Definitions Package’s Guards', () => {
  test('adding an exported Guard is one Additive Change, at its export', () => {
    const proposed = aDefinitions({
      exports: guardExports('authenticated'),
      guards: { authenticated: aGuard() },
    });

    const changes = changesOf(aBaselineDefinitions(), proposed);

    expect(changes).toEqual([additive(exportSite('authenticated'), { kind: 'added' })]);
  });

  test('removing an exported Guard is one Breaking Change, at its export', () => {
    const baseline = aBaselineDefinitions({
      exports: guardExports('authenticated'),
      guards: { authenticated: aGuard() },
    });

    const changes = changesOf(baseline, aDefinitions());

    expect(changes).toEqual([breaking(exportSite('authenticated'), { kind: 'removed' })]);
  });

  test('renaming an exported Guard is a removal plus an addition, at its exports', () => {
    const baseline = aBaselineDefinitions({
      exports: guardExports('authenticated'),
      guards: { authenticated: aGuard() },
    });
    const proposed = aDefinitions({
      exports: guardExports('signedIn'),
      guards: { signedIn: aGuard() },
    });

    const changes = changesOf(baseline, proposed);

    expect(changes).toEqual([
      breaking(exportSite('authenticated'), { kind: 'removed' }),
      additive(exportSite('signedIn'), { kind: 'added' }),
    ]);
  });

  test('a required demand added to a Guard is Breaking and needs an Approval', () => {
    const query = anOpenObject({ token: required(aString) });

    const changes = guardChangesOf(
      aGuard(),
      aGuard({ demands: { headers: { type: 'object', fields: {} }, query } }),
    );

    expect(changes).toEqual([breaking(guardSite, inputField(demandAt('query', 'token'), true))]);
  });

  test('an optional query demand added is Additive', () => {
    const query = anOpenObject({ token: optional(aString) });

    const changes = guardChangesOf(
      aGuard(),
      aGuard({ demands: { headers: { type: 'object', fields: {} }, query } }),
    );

    expect(changes).toEqual([additive(guardSite, inputField(demandAt('query', 'token'), false))]);
  });

  test('an optional header demand with a format added is one Breaking Change, by the header text rule alone', () => {
    const at = demandAt('headers', 'x-trace');
    const traced = anOpenObject({ 'x-trace': optional({ type: 'string', format: 'uuid' }) });

    const changes = guardChangesOf(
      aGuard(),
      aGuard({ demands: { headers: traced, query: { type: 'object', fields: {} } } }),
    );

    expect(changes).toEqual([breaking(guardSite, { kind: 'header-refuses-text', at })]);
  });

  test('an optional header demand that accepts every text added is Additive', () => {
    const at = demandAt('headers', 'x-trace');
    const traced = anOpenObject({ 'x-trace': optional(aString) });

    const changes = guardChangesOf(
      aGuard(),
      aGuard({ demands: { headers: traced, query: { type: 'object', fields: {} } } }),
    );

    expect(changes).toEqual([additive(guardSite, inputField(at, false))]);
  });

  test('removing a demand is Additive', () => {
    const query = anOpenObject({ token: required(aString) });

    const changes = guardChangesOf(
      aGuard({ demands: { headers: { type: 'object', fields: {} }, query } }),
      aGuard(),
    );

    expect(changes).toEqual([
      additive(guardSite, {
        kind: 'schema',
        position: 'input',
        at: demandAt('query', 'token'),
        shape: { kind: 'field-removed' },
      }),
    ]);
  });

  test.each([
    { name: 'gaining', from: [], to: [unauthenticated], kind: 'rejection-added' },
    { name: 'losing', from: [unauthenticated], to: [], kind: 'rejection-removed' },
  ] as const)('a Guard $name a Rejection is Additive', ({ from, to, kind }) => {
    const changes = guardChangesOf(aGuard({ rejections: from }), aGuard({ rejections: to }));

    expect(changes).toEqual([additive(guardSite, { kind, code: unauthenticated })]);
  });

  test.each([
    ['Context', { context: { type: 'object', fields: {} } }, { kind: 'context-changed' }],
    ['guards', { guards: ['session'] }, { kind: 'guards-changed' }],
    ['qualifier', { qualifier: { type: 'string' } }, { kind: 'qualifier-changed' }],
    ['description', { description: 'Checks the session' }, { kind: 'description-changed' }],
    [
      'origin',
      { origin: '@org/definitions@5.0.0#authenticated' },
      { kind: 'origin-changed', from: 'local', to: '@org/definitions@5.0.0#authenticated' },
    ],
  ] as const)('a Guard’s %s changed is one Neutral Change', (_name, fields, difference) => {
    const baseline = aBaselineDefinitions({ guards: { authenticated: aGuard() } });
    const proposed = aDefinitions({ guards: { authenticated: aGuard(fields) } });

    const report = reportOf(baseline, proposed);

    expect(report.changes).toEqual([neutral(guardSite, difference)]);
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

  test('removing an exported Guard and the code only it answers is one Breaking Change, at its export', () => {
    const baseline = aBaselineDefinitions({
      exports: guardExports('authenticated'),
      guards: { authenticated: aGuard({ rejections: [unauthenticated] }) },
      codes: { [unauthenticated]: aCode({ status: 401 }) },
    });

    const changes = changesOf(baseline, aDefinitions());

    expect(changes).toEqual([breaking(exportSite('authenticated'), { kind: 'removed' })]);
  });

  test('removing a code no export names, which a kept Guard answered, is only that Guard’s Additive rejection-removed', () => {
    const baseline = aBaselineDefinitions({
      exports: guardExports('authenticated'),
      guards: { authenticated: aGuard({ rejections: [unauthenticated] }) },
      codes: { [unauthenticated]: aCode({ status: 401 }) },
    });
    const proposed = aDefinitions({
      exports: guardExports('authenticated'),
      guards: { authenticated: aGuard() },
    });

    const changes = changesOf(baseline, proposed);

    expect(changes).toEqual([
      additive(guardSite, { kind: 'rejection-removed', code: unauthenticated }),
    ]);
  });
});

describe('compatibilityReportOf, a Definitions Package’s codes', () => {
  test('adding an exported Rejection is one Additive Change, at its export', () => {
    const proposed = aDefinitions({
      exports: rejectionExports(orderLocked),
      codes: { [orderLocked]: aCode() },
    });

    const changes = changesOf(aBaselineDefinitions(), proposed);

    expect(changes).toEqual([additive(exportSite(orderLocked), { kind: 'added' })]);
  });

  test('removing an exported Rejection is one Breaking Change, at its export', () => {
    const baseline = aBaselineDefinitions({
      exports: rejectionExports(orderLocked),
      codes: { [orderLocked]: aCode() },
    });

    const changes = changesOf(baseline, aDefinitions());

    expect(changes).toEqual([breaking(exportSite(orderLocked), { kind: 'removed' })]);
  });

  test('removing an exported Rejection a kept Guard answers is one Breaking Change at its export, and the Guard’s Additive rejection-removed', () => {
    const baseline = aBaselineDefinitions({
      exports: { ...guardExports('authenticated'), ...rejectionExports(unauthenticated) },
      guards: { authenticated: aGuard({ rejections: [unauthenticated] }) },
      codes: { [unauthenticated]: aCode({ status: 401 }) },
    });
    const proposed = aDefinitions({
      exports: guardExports('authenticated'),
      guards: { authenticated: aGuard() },
    });

    const changes = changesOf(baseline, proposed);

    expect(changes).toEqual([
      breaking(exportSite(unauthenticated), { kind: 'removed' }),
      additive(guardSite, { kind: 'rejection-removed', code: unauthenticated }),
    ]);
  });

  test('the code a Standard Rejection resolved to, gone, and its new code give the Standard Rejection’s Change alone', () => {
    const baseline = aBaselineDefinitions({
      codes: { [notFound]: aCode({ origin: 'standard', status: 404 }) },
    });
    const proposed = aDefinitions({
      standardRejections: { ...standardRejections, notFound: orderGone },
      codes: { [orderGone]: aCode({ origin: 'standard', status: 404 }) },
    });

    const changes = changesOf(baseline, proposed);

    expect(changes).toEqual([
      neutral(standardSite, { kind: 'code-changed', from: notFound, to: orderGone }),
    ]);
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
    const baseline = aBaselineDefinitions({
      codes: { [orderLocked]: aRemovedCode() },
    });

    const report = reportOf(baseline, aDefinitions());

    expect(report).toEqual({ changes: [] });
  });

  test('a removed code declared again through an export is added there and compared with what it last had', () => {
    const baseline = aBaselineDefinitions({
      codes: { [orderLocked]: aRemovedCode({ status: 409 }) },
    });
    const proposed = aDefinitions({
      exports: rejectionExports(orderLocked),
      codes: { [orderLocked]: aCode({ status: 422 }) },
    });

    const changes = changesOf(baseline, proposed);

    expect(changes).toEqual([
      additive(exportSite(orderLocked), { kind: 'added' }),
      breaking(codeSite(orderLocked), { kind: 'status-changed', from: 409, to: 422 }),
    ]);
  });

  test('a removed code declared again as it last was is one Additive Change, at its export', () => {
    const baseline = aBaselineDefinitions({ codes: { [orderLocked]: aRemovedCode() } });
    const proposed = aDefinitions({
      exports: rejectionExports(orderLocked),
      codes: { [orderLocked]: aCode() },
    });

    const changes = changesOf(baseline, proposed);

    expect(changes).toEqual([additive(exportSite(orderLocked), { kind: 'added' })]);
  });

  describe('a removed code whose body reaches a recursive def, declared again', () => {
    const ref: SchemaNode = { type: 'ref', name: 'tree' };
    const body = anOpenObject({ tree: required(ref) });
    const treeWith = (...labels: string[]): ObjectNode =>
      anOpenObject({
        children: required({ type: 'array', items: ref }),
        ...Object.fromEntries(labels.map((label) => [label, required(aString)])),
      });

    function declaredAgain(held: { removedWith: ObjectNode; since: ObjectNode; now: ObjectNode }) {
      const baseline = aBaselineDefinitions({
        defs: { tree: held.since },
        codes: {
          [orderLocked]: aRemovedCode({ body, defs: { tree: held.removedWith } }),
          [orderGone]: aCode({ body }),
        },
      });
      const proposed = aDefinitions({
        defs: { tree: held.now },
        codes: { [orderLocked]: aCode({ body }), [orderGone]: aCode({ body }) },
      });
      return changesOf(baseline, proposed).filter(
        ({ site }) => site.kind === 'code' && site.code === orderLocked,
      );
    }

    test('whose def lost a field since it was removed is Breaking, as against the version that removed it', () => {
      const changes = declaredAgain({
        removedWith: treeWith('label'),
        since: treeWith(),
        now: treeWith(),
      });

      expect(changes).toEqual([
        breaking(codeSite(orderLocked), {
          kind: 'schema',
          position: 'success',
          at: [
            { kind: 'part', name: 'body' },
            { kind: 'field', name: 'tree' },
            { kind: 'field', name: 'label' },
          ],
          shape: { kind: 'field-removed' },
        }),
      ]);
    });

    test('with the def it was removed with gives no Change at its code, though the Snapshot’s def of that name has since grown a field', () => {
      const changes = declaredAgain({
        removedWith: treeWith('label'),
        since: treeWith('label', 'note'),
        now: treeWith('label'),
      });

      expect(changes).toEqual([]);
    });
  });

  test('a Standard Rejection resolving to a code a user Rejection once used is compared with what it last had', () => {
    const baseline = aBaselineDefinitions({
      codes: {
        [notFound]: aCode({ origin: 'standard', status: 404 }),
        [orderGone]: aRemovedCode({ status: 409 }),
      },
    });
    const proposed = aDefinitions({
      standardRejections: { ...standardRejections, notFound: orderGone },
      codes: { [orderGone]: aCode({ origin: 'standard', status: 404 }) },
    });

    const changes = changesOf(baseline, proposed);

    expect(changes).toEqual([
      breaking(codeSite(orderGone), { kind: 'status-changed', from: 409, to: 404 }),
      neutral(codeSite(orderGone), { kind: 'origin-changed', from: 'local', to: 'standard' }),
      neutral(standardSite, { kind: 'code-changed', from: notFound, to: orderGone }),
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

    expect(changes).toEqual([
      neutral(codeSite(orderGone), { kind: 'origin-changed', from: 'local', to: 'standard' }),
      neutral(standardSite, { kind: 'code-changed', from: notFound, to: orderGone }),
    ]);
  });

  test('a Definitions Package’s Changes come: exports, then Guards, then codes by code in code point order', () => {
    const baseline = aBaselineDefinitions({
      guards: { authenticated: aGuard() },
      codes: { [orderLocked]: aCode(), [orderGone]: aCode() },
    });
    const query = anOpenObject({ page: optional(aString) });
    const proposed = aDefinitions({
      exports: schemaExports({ money: anOpenObject() }),
      guards: { authenticated: aGuard({ demands: { ...aGuard().demands, query } }) },
      codes: { [orderLocked]: aCode({ status: 422 }), [orderGone]: aCode({ status: 422 }) },
    });

    const changes = changesOf(baseline, proposed);

    expect(changes.map(({ site }) => [site.kind, placeOf(site)])).toEqual([
      ['export', 'money'],
      ['guard', 'authenticated'],
      ['code', orderGone],
      ['code', orderLocked],
    ]);
  });
});

describe('compatibilityReportOf, one removal from a Definitions Package', () => {
  const declared: DefinitionsSnapshot = JSON.parse(
    readFileSync(
      new URL('../../../../examples/org-definitions/contract.snapshot.json', import.meta.url),
      'utf8',
    ),
  );

  /** A declared Snapshot as published, read back by the decoder; one it refuses is reported whole. */
  function decodedOf(snapshot: DefinitionsSnapshot) {
    const text = JSON.stringify({ ...snapshot, version: '4.2.0', generator: publishedBy });
    return decodeSnapshot(text);
  }

  function publishedOf(snapshot: DefinitionsSnapshot): PublishedDefinitionsSnapshot {
    const decoded = decodedOf(snapshot);
    if (decoded.kind !== 'decoded' || decoded.snapshot.kind !== 'definitions') {
      throw new Error(`Expected a decoded Definitions Snapshot: ${JSON.stringify(decoded)}`);
    }
    return decoded.snapshot;
  }

  /**
   * The declared Snapshot without one export and whatever only that export used, as `generate`
   * would write it: each def, Guard or code the decoder finds unused is left out in turn.
   */
  function withoutExport(name: string): DefinitionsSnapshot {
    const { [name]: _removed, ...exports } = declared.exports;
    let held: Record<string, unknown> = { ...declared, exports };
    for (let decoded = decodedOf(held as DefinitionsSnapshot); decoded.kind !== 'decoded'; ) {
      const [part, key] = decoded.kind === 'malformed' ? decoded.at : [];
      const container = typeof part === 'string' ? held[part] : undefined;
      if (typeof key !== 'string' || typeof container !== 'object' || container === null) {
        throw new Error(`Expected an unused name: ${JSON.stringify(decoded)}`);
      }
      const { [key]: _unused, ...kept } = container as Record<string, unknown>;
      held = { ...held, [part as string]: kept };
      decoded = decodedOf(held as DefinitionsSnapshot);
    }
    return held as DefinitionsSnapshot;
  }

  test.each(Object.keys(declared.exports))(
    'removing the export %s, and what only it used, is one removed Change, at the export',
    (name) => {
      const { changes } = compatibilityReportOf(publishedOf(declared), withoutExport(name));

      const removals = changes.filter(({ difference }) => difference.kind === 'removed');
      expect(removals).toEqual([breaking(exportSite(name), { kind: 'removed' })]);
    },
  );
});
