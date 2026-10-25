import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import type * as core from 'zod/v4/core';
import { aRootPackage, exporting } from '../../test/root-package.ts';
import {
  defineContract,
  defineDefinitions,
  defineEndpoint,
  defineGroup,
  defineGuard,
  defineRejection,
  type Guard,
} from '../index.ts';
import {
  compatibilityReportOf,
  decodeSnapshot,
  type ResolvedDefinitions,
  type Snapshot,
  schemaOriginsOf,
  snapshotOf,
  validateContract,
} from '../internal/index.ts';

/** A seeded generator of the same sequence every run, so a failing draw can be replayed. */
function seededNext(seed: number): () => number {
  let state = seed;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

/** A camelCase name drawn from the generator. */
function nameOf(next: () => number): string {
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  const length = 2 + Math.floor(next() * 6);
  return Array.from({ length }, () => letters[Math.floor(next() * letters.length)]).join('');
}

/** The Snapshot of a Definitions root whose file exports what is given beside it. */
function definitionsSnapshotOf(exported: Readonly<Record<string, unknown>>) {
  const root = defineDefinitions({});
  const rootPackage = aRootPackage(root, { exportsOf: exporting([root, exported]) });
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
  if (snapshot.kind !== 'definitions') {
    throw new Error('The fixture is no Definitions Package');
  }
  return snapshot;
}

/** The Snapshot of a Service that lists the packages given and has one Endpoint. */
function serviceSnapshotOf(packages: readonly ResolvedDefinitions[], endpoint = aPing()) {
  const group = defineGroup({ name: 'ping', description: 'Ping', endpoints: [endpoint] });
  const definitions = packages.map((resolved) => resolved.definitions);
  const root = defineContract({ name: 'ping-service', definitions, groups: [group] });
  const rootPackage = aRootPackage(root, { packages, originOf: schemaOriginsOf(packages) });
  const validated = validateContract(root, rootPackage);
  if (validated.kind !== 'valid') {
    throw new Error(`The fixture is invalid: ${JSON.stringify(validated.failures)}`);
  }
  const context = { generator: 'test', packages, committed: undefined, now: 0 };
  const snapshot = snapshotOf(validated, context);
  if (snapshot.kind !== 'service') {
    throw new Error('The fixture is no Service');
  }
  return snapshot;
}

function aPing(guards: readonly Guard[] = [], body: core.$ZodType = z.object({ ok: z.boolean() })) {
  return defineEndpoint({
    name: 'ping',
    method: 'GET',
    path: '/ping',
    visibility: 'public',
    description: 'Ping',
    guards: [...guards],
    success: { status: 200, body: body as z.ZodObject },
  });
}

function aPackage(
  packageName: string,
  exported: Readonly<Record<string, unknown>>,
): ResolvedDefinitions {
  const definitions = defineDefinitions({});
  return { definitions, packageName, version: '1.0.0', exports: { definitions, ...exported } };
}

const apiKey = defineGuard({ name: 'apiKey', description: 'A key' });
const forbidden = defineRejection({ code: 'FORBIDDEN', status: 403, message: 'Forbidden' });
const money = z.object({ amount: z.int() });

describe('snapshotOf: a Definitions Package’s exports', () => {
  test('a schema exported under two names is in exports under both', () => {
    const snapshot = definitionsSnapshotOf({ money, amount: money });

    expect(Object.keys(snapshot.exports).sort()).toEqual(['amount', 'money']);
    expect(snapshot.exports['amount']).toEqual(snapshot.exports['money']);
  });

  test('a Guard exported under another name is in exports under that name, and in guards under its own', () => {
    const snapshot = definitionsSnapshotOf({ key: apiKey, forbidden });

    expect(snapshot.exports).toEqual({
      forbidden: { kind: 'rejection', code: 'FORBIDDEN' },
      key: { kind: 'guard', guard: 'apiKey' },
    });
    expect(Object.keys(snapshot.guards)).toEqual(['apiKey']);
  });

  test('the exports keys are the root file’s export names, each naming its value', () => {
    const next = seededNext(179);
    for (let draw = 0; draw < 50; draw += 1) {
      const values = [
        defineGuard({ name: `guard${draw}`, description: 'A guard' }),
        defineRejection({ code: `CODE_${draw}`, status: 409, message: 'Taken' }),
        z.object({ count: z.int() }),
      ];
      const exported: Record<string, unknown> = {};
      for (const value of values) {
        const names = Array.from({ length: 1 + Math.floor(next() * 3) }, () => nameOf(next));
        for (const name of names) {
          exported[name] = value;
        }
      }

      const snapshot = definitionsSnapshotOf(exported);

      expect(Object.keys(snapshot.exports).sort()).toEqual(Object.keys(exported).sort());
      for (const [name, value] of Object.entries(exported)) {
        expect(snapshot.exports[name]?.kind).toBe(kindOf(value, values));
      }
    }
  });
});

function kindOf(value: unknown, values: readonly unknown[]): string {
  return ['guard', 'rejection', 'schema'][values.indexOf(value)] ?? 'none';
}

describe('snapshotOf: what a Service takes from a Definitions Package’s exports', () => {
  test('a Service’s shared schema origin names the export it is shared under', () => {
    const orgPackage = aPackage('@org/definitions', { amount: money });

    const snapshot = serviceSnapshotOf([orgPackage], aPing([], z.object({ total: money })));

    const body = snapshot.endpoints['GET /ping']?.success.body;
    const total = body?.type === 'object' ? body.fields['total']?.schema : undefined;
    expect(total).toMatchObject({ origin: '@org/definitions@1.0.0#amount' });
  });

  test('a Guard a listed package exports takes the package’s origin, with no list', () => {
    const orgPackage = aPackage('@org/definitions', { apiKey });

    const snapshot = serviceSnapshotOf([orgPackage], aPing([apiKey]));

    expect(snapshot.guards['apiKey']?.origin).toBe('@org/definitions@1.0.0');
  });

  test('each reached Guard has the origin of the first listed package exporting that very object, else local', () => {
    const next = seededNext(1790);
    for (let draw = 0; draw < 40; draw += 1) {
      const guards = Array.from({ length: 4 }, (_, index) =>
        defineGuard({ name: `guard${index}`, description: 'A guard' }),
      );
      const owners = guards.map(() => Math.floor(next() * 3));
      const exportedBy = (owner: number) =>
        Object.fromEntries(
          guards.filter((_, index) => owners[index] === owner).map((guard) => [guard.name, guard]),
        );
      const packages = [
        aPackage('@org/first', exportedBy(1)),
        aPackage('@org/second', exportedBy(2)),
      ];

      const snapshot = serviceSnapshotOf(packages, aPing(guards));

      const expected = ['local', '@org/first@1.0.0', '@org/second@1.0.0'];
      const origins = guards.map((guard) => snapshot.guards[guard.name]?.origin);
      expect(origins).toEqual(owners.map((owner) => expected[owner]));
    }
  });
});

/** The Check of a Definitions Package exporting `before`, then `after`. */
function changesOf(
  before: Readonly<Record<string, unknown>>,
  after: Readonly<Record<string, unknown>>,
) {
  const baseline = { ...definitionsSnapshotOf(before), version: '1.0.0' };
  const report = compatibilityReportOf(baseline, definitionsSnapshotOf(after));
  if (report.kind !== 'compared') {
    throw new Error('the Baseline was given, so the report must have compared');
  }
  return report.changes.filter(({ site }) => site.kind === 'export');
}

describe('compatibilityReportOf: a Definitions Package’s exports', () => {
  test.each([
    ['a Guard', { thing: apiKey }],
    ['a Rejection', { thing: forbidden }],
    ['a schema', { thing: money }],
  ])(
    'renaming an export that is %s reports its removal Breaking and its new name Additive',
    (_, before) => {
      const after = { renamed: Object.values(before)[0] };

      const changes = changesOf(before, after);

      expect(changes).toEqual([
        {
          site: { kind: 'export', name: 'renamed', visibility: 'public' },
          difference: { kind: 'added' },
          class: 'additive',
          verdict: 'allowed',
        },
        {
          site: { kind: 'export', name: 'thing', visibility: 'public' },
          difference: { kind: 'removed' },
          class: 'breaking',
          verdict: 'approval-needed',
        },
      ]);
    },
  );

  const bearer = defineGuard({ name: 'bearer', description: 'A token' });
  const gone = defineRejection({ code: 'GONE', status: 410, message: 'Gone' });

  test.each([
    {
      names: 'another Guard',
      before: { thing: apiKey } as Record<string, unknown>,
      after: { thing: bearer } as Record<string, unknown>,
      from: 'guard apiKey',
      to: 'guard bearer',
    },
    {
      names: 'another code',
      before: { thing: forbidden } as Record<string, unknown>,
      after: { thing: gone } as Record<string, unknown>,
      from: 'rejection FORBIDDEN',
      to: 'rejection GONE',
    },
    {
      names: 'another kind',
      before: { thing: money } as Record<string, unknown>,
      after: { thing: apiKey } as Record<string, unknown>,
      from: 'schema',
      to: 'guard apiKey',
    },
  ])(
    'an export that now names $names is Breaking and needs an Approval',
    ({ before, after, from, to }) => {
      const changes = changesOf(before, after);

      expect(changes).toEqual([
        {
          site: { kind: 'export', name: 'thing', visibility: 'public' },
          difference: { kind: 'export-changed', from, to },
          class: 'breaking',
          verdict: 'approval-needed',
        },
      ]);
    },
  );
});

describe('decodeSnapshot: a Definitions Package’s exports', () => {
  function textOf(snapshot: Snapshot, fields: Readonly<Record<string, unknown>>): string {
    return JSON.stringify({ ...snapshot, version: '1.0.0', ...fields });
  }

  test.each([
    ['a Guard', { kind: 'guard', guard: 'missing' }, 'guard'],
    ['a code', { kind: 'rejection', code: 'MISSING' }, 'code'],
  ])(
    'an export naming %s the Snapshot does not hold fails to decode at it',
    (_, exported, field) => {
      const snapshot = definitionsSnapshotOf({});

      const decoded = decodeSnapshot(textOf(snapshot, { exports: { thing: exported } }));

      expect(decoded).toMatchObject({ kind: 'malformed', at: ['exports', 'thing', field] });
    },
  );

  test('a Definitions Snapshot with a schemas key fails to decode', () => {
    const snapshot = definitionsSnapshotOf({});

    const decoded = decodeSnapshot(textOf(snapshot, { schemas: {} }));

    expect(decoded).toMatchObject({ kind: 'malformed', at: ['schemas'] });
  });
});
