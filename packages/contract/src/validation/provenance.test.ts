import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import {
  anInstalledPackage,
  anUnidentifiedPackage,
  aRootPackage,
} from '../../test/root-package.ts';
import {
  type Definitions,
  defineDefinitions,
  defineEndpoint,
  defineGroup,
  defineGuard,
  defineRejection,
  defineService,
  type Guard,
  type Rejection,
} from '../index.ts';
import {
  type ImportedDefinitions,
  type Root,
  type Snapshot,
  snapshotOf,
  validateRoot,
} from '../internal/index.ts';

const context = { generator: 'test', committed: undefined, now: 0 };

/** A Service whose one Endpoint attaches the Guards, answers the Rejections and returns the body given. */
function aService(
  { guards = [], rejections = [], body = z.object({ ok: z.boolean() }) }: Reached,
  standardRejections?: Definitions,
) {
  const ping = defineEndpoint({
    name: 'ping',
    method: 'GET',
    path: '/ping',
    visibility: 'public',
    description: 'Ping',
    guards: [...guards],
    success: { status: 200, body },
    rejections: [...rejections],
  });
  const group = defineGroup({ name: 'ping', description: 'Ping', endpoints: [ping] });
  return defineService({
    name: 'ping-service',
    groups: [group],
    ...(standardRejections === undefined ? {} : { standardRejections }),
  });
}

type Reached = {
  readonly guards?: readonly Guard[];
  readonly rejections?: readonly Rejection[];
  readonly body?: z.ZodObject;
};

function validatedOf(root: Root, packages: readonly ImportedDefinitions[]) {
  return validateRoot(root, aRootPackage(root, { packages }));
}

function snapshotIn(root: Root, packages: readonly ImportedDefinitions[]): Snapshot {
  const validated = validatedOf(root, packages);
  if (validated.kind !== 'valid') {
    throw new Error(`The fixture is invalid: ${JSON.stringify(validated.failures)}`);
  }
  return snapshotOf(validated, context);
}

function serviceIn(root: Root, packages: readonly ImportedDefinitions[]) {
  const snapshot = snapshotIn(root, packages);
  if (snapshot.kind !== 'service') {
    throw new Error('The fixture is no Service');
  }
  return snapshot;
}

/** A Definitions Package installed as `name@1.0.0`, exporting what is given, reaching the packages given. */
function aPackage(
  packageName: string,
  exported: Readonly<Record<string, unknown>>,
  reaches: readonly ImportedDefinitions[] = [],
): ImportedDefinitions {
  const installed = { packageName, version: '1.0.0', reaches };
  return anInstalledPackage(defineDefinitions({}), exported, installed);
}

/** A Definitions Package installed under `name` whose package.json has no version, exporting what is given. */
function anUnversionedPackage(
  packageName: string,
  exported: Readonly<Record<string, unknown>>,
  reaches: readonly ImportedDefinitions[] = [],
): ImportedDefinitions {
  return anUnidentifiedPackage({ kind: 'unversioned', packageName }, exported, { reaches });
}

/** The origin of the `total` field of the ping's Success body. */
function totalOrigin(snapshot: ReturnType<typeof serviceIn>): unknown {
  const body = snapshot.endpoints['GET /ping']?.success.body;
  const total = body?.type === 'object' ? body.fields['total']?.schema : undefined;
  return total === undefined ? undefined : Reflect.get(total, 'origin');
}

const apiKey = defineGuard({ name: 'apiKey', description: 'A key' });
const forbidden = defineRejection({ code: 'FORBIDDEN', status: 403, message: 'Forbidden' });
const money = z.object({ amount: z.int() });

describe('validateRoot and snapshotOf: where a reached declaration came from', () => {
  test('a Guard, a Rejection and a schema an installed package exports take its origin, with no list', () => {
    const org = aPackage('@org/definitions', { apiKey, forbidden, money });
    const root = aService({
      guards: [apiKey],
      rejections: [forbidden],
      body: z.object({ total: money }),
    });

    const snapshot = serviceIn(root, [org]);

    expect(snapshot.guards['apiKey']?.origin).toBe('@org/definitions@1.0.0');
    expect(snapshot.codes['FORBIDDEN']?.origin).toBe('@org/definitions@1.0.0');
    expect(totalOrigin(snapshot)).toBe('@org/definitions@1.0.0#money');
  });

  test('a Guard reached only through another Guard’s guards takes its package’s origin', () => {
    const permission = defineGuard({
      name: 'permission',
      description: 'Builds on the key',
      guards: [apiKey],
    });
    const org = aPackage('@org/definitions', { apiKey, permission });
    const own = defineGuard({
      name: 'own',
      description: 'Builds on permission',
      guards: [permission],
    });

    const snapshot = serviceIn(aService({ guards: [apiKey, permission, own] }), [org]);

    expect(snapshot.guards['apiKey']?.origin).toBe('@org/definitions@1.0.0');
    expect(snapshot.guards['own']?.origin).toBe('local');
  });

  test('a schema of one package reached inside another’s takes its own package’s origin', () => {
    const order = z.object({ total: money });
    const p2 = aPackage('@p2/defs', { money });
    const p1 = aPackage('@p1/defs', { order }, [p2]);

    const snapshot = serviceIn(aService({ body: z.object({ order }) }), [p1, p2]);

    const body = snapshot.endpoints['GET /ping']?.success.body;
    const orderNode = body?.type === 'object' ? body.fields['order']?.schema : undefined;
    expect(orderNode).toMatchObject({
      origin: '@p1/defs@1.0.0#order',
      fields: { total: { schema: { origin: '@p2/defs@1.0.0#money' } } },
    });
  });

  test('an installed package the Contract reaches nothing of appears in no origin', () => {
    const org = aPackage('@org/definitions', { apiKey });
    const unused = aPackage('@org/unused', { forbidden });

    const text = JSON.stringify(serviceIn(aService({ guards: [apiKey] }), [org, unused]));

    expect(text).not.toContain('@org/unused');
  });

  test('the package named as standardRejections gives the Standard Rejections’ codes, with its origin', () => {
    const definitions = defineDefinitions({
      standardRejections: {
        notFound: { code: 'RESOURCE_NOT_FOUND', status: 404, message: 'Not here' },
      },
    });
    const org = anInstalledPackage(definitions, {}, { version: '1.0.0' });

    const snapshot = serviceIn(aService({}, definitions), [org]);

    expect(snapshot.standardRejections.notFound).toBe('RESOURCE_NOT_FOUND');
    expect(snapshot.codes['RESOURCE_NOT_FOUND']?.origin).toBe('@org/definitions@1.0.0');
    expect(snapshot.codes['INVALID_INPUT']?.origin).toBe('standard');
    expect(snapshot).not.toHaveProperty('definitions');
  });

  test('a Guard one package re-exports from another it imports belongs to the other', () => {
    const p2 = aPackage('@p2/defs', { apiKey });
    const p1 = aPackage('@p1/defs', { apiKey }, [p2]);

    const onlyP1 = serviceIn(aService({ guards: [apiKey] }), [p1, p2]);
    const both = serviceIn(aService({ guards: [apiKey] }), [p2, p1]);

    expect(onlyP1.guards['apiKey']?.origin).toBe('@p2/defs@1.0.0');
    expect(both.guards['apiKey']?.origin).toBe('@p2/defs@1.0.0');
  });

  test('a Guard an identified package re-exports from one with no version belongs to that one, and fails definitions-unidentified', () => {
    const base = anUnversionedPackage('@org/base', { apiKey });
    const org = aPackage('@org/definitions', { apiKey }, [base]);

    const validated = validatedOf(aService({ guards: [apiKey] }), [org, base]);

    expect(validated).toEqual({
      kind: 'invalid',
      failures: [
        {
          kind: 'declaration',
          at: ['guards', 'apiKey'],
          rule: 'definitions-unidentified',
          message:
            'A Definitions Package a declaration comes from has a name and a version: @org/base has no version in its package.json',
        },
      ],
    });
  });

  test('a Guard an identified and a nameless package export, neither importing the other, fails definitions-ambiguous naming the package.json', () => {
    const manifest = 'node_modules/other/package.json';
    const other = anUnidentifiedPackage({ kind: 'unnamed', manifest }, { apiKey });
    const org = aPackage('@org/definitions', { apiKey });

    const validated = validatedOf(aService({ guards: [apiKey] }), [org, other]);

    expect(validated).toMatchObject({
      kind: 'invalid',
      failures: [
        {
          at: ['guards', 'apiKey'],
          rule: 'definitions-ambiguous',
          message: `A declaration belongs to one Definitions Package: exported by both @org/definitions and ${manifest}, and neither imports it from the other`,
        },
      ],
    });
  });

  test('a code and a schema from a package with no version fail definitions-unidentified where each sits', () => {
    const base = anUnversionedPackage('@org/base', { forbidden, money });
    const root = aService({ rejections: [forbidden], body: z.object({ total: money }) });

    const validated = validatedOf(root, [base]);

    expect(validated).toMatchObject({
      kind: 'invalid',
      failures: [
        { at: ['rejections', 'FORBIDDEN'], rule: 'definitions-unidentified' },
        {
          at: ['groups', 'ping', 'endpoints', 'GET /ping', 'success', 'body', 'fields', 'total'],
          rule: 'definitions-unidentified',
        },
      ],
    });
  });

  test('a schema from a package with no version met at two places fails once, where the walk first met it', () => {
    const base = anUnversionedPackage('@org/base', { money });
    const root = aService({ body: z.object({ first: money, second: money }) });

    const validated = validatedOf(root, [base]);

    const at = ['groups', 'ping', 'endpoints', 'GET /ping', 'success', 'body', 'fields'];
    expect(validated).toMatchObject({
      kind: 'invalid',
      failures: [{ at: [...at, 'first'], rule: 'definitions-unidentified' }],
    });
    expect(validated.kind === 'invalid' && validated.failures).toHaveLength(1);
  });

  test('a package with no version the Contract reaches nothing of fails nothing', () => {
    const base = anUnversionedPackage('@org/base', { forbidden });
    const org = aPackage('@org/definitions', { apiKey });

    const snapshot = serviceIn(aService({ guards: [apiKey] }), [org, base]);

    expect(snapshot.guards['apiKey']?.origin).toBe('@org/definitions@1.0.0');
  });

  test('a Guard two packages export, each importing the other, fails definitions-ambiguous', () => {
    const p1Reaches: ImportedDefinitions[] = [];
    const p1 = aPackage('@p1/defs', { apiKey }, p1Reaches);
    const p2 = aPackage('@p2/defs', { apiKey }, [p1]);
    p1Reaches.push(p2);

    const validated = validatedOf(aService({ guards: [apiKey] }), [p1, p2]);

    expect(validated).toEqual({
      kind: 'invalid',
      failures: [
        {
          kind: 'declaration',
          at: ['guards', 'apiKey'],
          rule: 'definitions-ambiguous',
          message:
            'A declaration belongs to one Definitions Package: exported by both @p1/defs and @p2/defs, and neither imports it from the other',
        },
      ],
    });
  });

  test('a schema two packages export, neither importing the other, fails where the walk meets it', () => {
    const p1 = aPackage('@p1/defs', { money });
    const p2 = aPackage('@p2/defs', { money });

    const validated = validatedOf(aService({ body: z.object({ total: money }) }), [p1, p2]);

    expect(validated).toMatchObject({
      kind: 'invalid',
      failures: [
        {
          at: ['groups', 'ping', 'endpoints', 'GET /ping', 'success', 'body', 'fields', 'total'],
          rule: 'definitions-ambiguous',
        },
      ],
    });
  });

  test('a Definitions Package re-exporting another package’s Guard writes that package’s origin, and its own Guards stay local', () => {
    const p2 = aPackage('@p2/defs', { apiKey });
    const own = defineGuard({ name: 'own', description: 'Its own', guards: [apiKey] });
    const root = defineDefinitions({});

    const validated = validateRoot(
      root,
      aRootPackage(root, { packages: [p2], rootExports: { apiKey, own } }),
    );
    const snapshot = validated.kind === 'valid' ? snapshotOf(validated, context) : undefined;

    expect(snapshot?.kind === 'definitions' && snapshot.guards['apiKey']?.origin).toBe(
      '@p2/defs@1.0.0',
    );
    expect(snapshot?.kind === 'definitions' && snapshot.guards['own']?.origin).toBe('local');
  });
});

/** How package P1 reaches P2 in a row of the exhaustive table. */
type Edge = 'direct' | 'none';

/** Which packages export a member in a row: P1, P2, both, or neither. */
type Exporters = 'p1' | 'p2' | 'both' | 'none';

/** Whether P2's package.json names it in a row. */
type P2Identity = 'identified' | 'unversioned';

/** What the rule does with a member in a row: the origin it writes, or the rule it fails. */
type Expected = string | 'ambiguous' | 'unidentified';

/** The origin the rule gives a member, from a reference model of it written apart from the code. */
function expectedOrigin(exporters: Exporters, edge: Edge, p2: P2Identity): Expected {
  const ofP2 = p2 === 'identified' ? '@p2/defs@1.0.0' : 'unidentified';
  switch (exporters) {
    case 'none':
      return 'local';
    case 'p1':
      return '@p1/defs@1.0.0';
    case 'p2':
      return ofP2;
    case 'both':
      return edge === 'direct' ? ofP2 : 'ambiguous';
  }
}

function isFailing(expected: Expected): expected is 'ambiguous' | 'unidentified' {
  return expected === 'ambiguous' || expected === 'unidentified';
}

const exporterRows: readonly Exporters[] = ['p1', 'p2', 'both', 'none'];
const edgeRows: readonly Edge[] = ['direct', 'none'];
const p2Rows: readonly P2Identity[] = ['identified', 'unversioned'];
/** One row of the exhaustive table. */
type Row = (typeof rows)[number];

const rows = p2Rows.flatMap((p2) =>
  edgeRows.flatMap((edge) =>
    exporterRows.flatMap((guardBy) =>
      exporterRows.map((codeBy) => ({ p2, edge, guardBy, codeBy })),
    ),
  ),
);

/** Whether a package exports a member in a row. */
function isExportedBy(owner: 'p1' | 'p2', by: Exporters): boolean {
  return by === owner || by === 'both';
}

describe('validateRoot and snapshotOf: provenance follows identity and imports', () => {
  test.each(rows)(
    'a Guard exported by $guardBy and a code by $codeBy, P1 reaching P2: $edge, P2 $p2',
    (row) => {
      const guard = defineGuard({ name: 'gate', description: 'A gate' });
      const rejection = defineRejection({ code: 'TAKEN', status: 409, message: 'Taken' });
      const members = { gate: guard, taken: rejection };
      const p2 = p2PackageOf(row.p2, exportedBy('p2', row, members));
      const p1 = aPackage(
        '@p1/defs',
        exportedBy('p1', row, members),
        row.edge === 'direct' ? [p2] : [],
      );
      const root = aService({ guards: [guard], rejections: [rejection] });

      const validated = validatedOf(root, [p1, p2]);

      const expected = [
        expectedOrigin(row.guardBy, row.edge, row.p2),
        expectedOrigin(row.codeBy, row.edge, row.p2),
      ];
      if (expected.some(isFailing)) {
        const rules = validated.kind === 'invalid' ? validated.failures.map(ruleOf) : [];
        expect(rules).toEqual(expected.filter(isFailing).map((rule) => `definitions-${rule}`));
        return;
      }
      const snapshot = serviceIn(root, [p1, p2]);
      expect([snapshot.guards['gate']?.origin, snapshot.codes['TAKEN']?.origin]).toEqual(expected);
    },
  );
});

/** A row's members as the package `owner` exports them: `gate` and `taken`, each when the row says so. */
function exportedBy(
  owner: 'p1' | 'p2',
  { guardBy, codeBy }: Row,
  { gate, taken }: { readonly gate: Guard; readonly taken: Rejection },
): Readonly<Record<string, unknown>> {
  return {
    ...(isExportedBy(owner, guardBy) ? { gate } : {}),
    ...(isExportedBy(owner, codeBy) ? { taken } : {}),
  };
}

/** P2 as a row installs it: named `@p2/defs@1.0.0`, or with no version in its package.json. */
function p2PackageOf(
  identity: P2Identity,
  exported: Readonly<Record<string, unknown>>,
): ImportedDefinitions {
  return identity === 'identified'
    ? aPackage('@p2/defs', exported)
    : anUnversionedPackage('@p2/defs', exported);
}

function ruleOf(failure: { readonly kind: string; readonly rule?: string }): string {
  return failure.rule ?? failure.kind;
}

/** A seeded generator of the same sequence every run, so a failing draw can be replayed. */
function seededNext(seed: number): () => number {
  let state = seed;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

describe('validateRoot and snapshotOf: origins are exactly the packages used', () => {
  test('the origins name exactly the packages whose Guards, codes and schemas the Contract reaches, two copies of one name counted as two', () => {
    const next = seededNext(178);
    const versions = ['1.0.0', '2.0.0', '3.0.0'];
    for (let draw = 0; draw < 40; draw += 1) {
      const members: readonly { readonly name: string; readonly value: unknown }[] = [
        { name: 'gate', value: defineGuard({ name: 'gate', description: 'A gate' }) },
        { name: 'taken', value: defineRejection({ code: 'TAKEN', status: 409, message: 'Taken' }) },
        { name: 'money', value: z.object({ amount: z.int() }) },
      ];
      const owners = members.map(() => Math.floor(next() * 4));
      const isReached = members.map(() => next() < 0.6);
      const packages = versions.map((version, index) =>
        anInstalledPackage(
          defineDefinitions({}),
          Object.fromEntries(
            members.filter((_, at) => owners[at] === index).map(({ name, value }) => [name, value]),
          ),
          { packageName: '@org/definitions', version },
        ),
      );
      const [gate, taken, schema] = members.map(({ value }, at) =>
        isReached[at] ? value : undefined,
      );
      const root = aService({
        guards: gate === undefined ? [] : [gate as Guard],
        rejections: taken === undefined ? [] : [taken as Rejection],
        body: z.object({ total: (schema as z.ZodObject | undefined) ?? z.string() }),
      });

      const snapshot = serviceIn(root, packages);

      const origins = new Set(
        [
          ...Object.values(snapshot.guards).map(({ origin }) => origin),
          snapshot.codes['TAKEN']?.origin,
          totalOrigin(snapshot),
        ].map((origin) => (typeof origin === 'string' ? origin.split('#')[0] : origin)),
      );
      const used = new Set(
        owners
          .filter((owner, at) => isReached[at] && owner < 3)
          .map((owner) => `@org/definitions@${versions[owner]}`),
      );
      expect(new Set([...origins].filter((origin) => String(origin).startsWith('@')))).toEqual(
        used,
      );
    }
  });
});
