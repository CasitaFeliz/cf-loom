import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { seededNext } from '../../test/random-schemas.ts';
import { anInstalledPackage, aRootPackage } from '../../test/root-package.ts';
import {
  defineDefinitions,
  defineEndpoint,
  defineEvent,
  defineGroup,
  defineService,
  type Endpoint,
  type Event,
  openEnum,
} from '../index.ts';
import { failureLineOf, type Root, type RootPackage, validateRoot } from '../internal/index.ts';

/** The lines `generate` prints for a Root. */
function linesOf(root: Root, given: Partial<RootPackage> = {}): readonly string[] {
  const validated = validateRoot(root, aRootPackage(root, given));
  return validated.kind === 'invalid' ? validated.failures.map(failureLineOf) : [];
}

/** An Endpoint named `name` at a route such as `GET /things`, answering a body of the fields given. */
function anEndpoint(name: string, route: string, fields: Readonly<Record<string, z.ZodType>>) {
  const [method, path] = route.split(' ');
  return defineEndpoint({
    name,
    method,
    path,
    visibility: 'public',
    description: 'd',
    success: { status: 200, body: z.object(fields) },
  } as never);
}

/** An Event named `name`, carrying a body of the fields given. */
function anEvent(name: string, fields: Readonly<Record<string, z.ZodType>>): Event {
  return defineEvent({
    name,
    version: 1,
    visibility: 'internal',
    description: 'd',
    body: z.object(fields),
  });
}

function serviceWith(endpoints: readonly Endpoint[], events: readonly Event[] = []): Root {
  const group = defineGroup({
    name: 'shapes',
    description: 'Shapes',
    ...(endpoints.length > 0 && { endpoints }),
    ...(events.length > 0 && { events }),
  } as never);
  return defineService({ name: 'orders-service', groups: [group] });
}

const date = 'not allowed: z.date() (use z.iso.datetime())';
const unionIsRefused =
  'not allowed: a z.union() reaching an openEnum() (use z.discriminatedUnion(), or one openEnum() of all the values)';

/** A recursive def holding a date, as a function so each test has a schema of its own. */
function dateTree() {
  const tree: z.ZodType = z
    .object({
      at: z.date(),
      get children() {
        return z.array(tree);
      },
    })
    .meta({ id: 'tree' });
  return tree;
}

describe('failure lines: a schema in a recursive def, reached from several sites', () => {
  test.for([
    ['declared in code point order', ['a', 'z']],
    ['declared against it', ['z', 'a']],
  ] as const)('a date in a def is one line at the first site, %s', ([, order]) => {
    const tree = dateTree();
    const routes = { a: ['alpha', 'GET /a'], z: ['zed', 'GET /z'] } as const;
    const endpoints = order.map((key) => anEndpoint(routes[key][0], routes[key][1], { t: tree }));

    expect(linesOf(serviceWith(endpoints))).toEqual([
      `endpoints.GET /a (alpha) success.body.t.at ${date} (also in endpoints.GET /z (zed))`,
    ]);
  });

  test('a cycle no id names is one line at the first site', () => {
    const category: z.ZodType = z.object({
      get children() {
        return z.array(category);
      },
    });
    const endpoints = [
      anEndpoint('zed', 'GET /z', { c: category }),
      anEndpoint('alpha', 'GET /a', { l: z.object({ c: category }) }),
    ];

    expect(linesOf(serviceWith(endpoints))).toEqual([
      'endpoints.GET /a (alpha) success.body.l.c.children[] not allowed: a cycle without .meta({ id }) (use .meta({ id })) (also in endpoints.GET /z (zed))',
    ]);
  });

  test('a def shared by an Event and an Endpoint is one line naming both', () => {
    const tree = dateTree();

    const lines = linesOf(
      serviceWith([anEndpoint('alpha', 'GET /a', { t: tree })], [anEvent('Grew', { t: tree })]),
    );

    expect(lines).toEqual([
      `endpoints.GET /a (alpha) success.body.t.at ${date} (also in events.Grew@1)`,
    ]);
  });

  test.for(['a', 'z'] as const)('nested defs are one line, with %s declared first', (first) => {
    const inner: z.ZodType = z
      .object({
        at: z.date(),
        get children() {
          return z.array(inner);
        },
      })
      .meta({ id: 'inner' });
    const outer: z.ZodType = z
      .object({
        i: inner,
        get more() {
          return z.array(outer);
        },
      })
      .meta({ id: 'outer' });
    const endpoints = {
      a: anEndpoint('alpha', 'GET /a', { x: inner }),
      z: anEndpoint('zed', 'GET /z', { y: outer }),
    };
    const ordered = first === 'a' ? [endpoints.a, endpoints.z] : [endpoints.z, endpoints.a];

    expect(linesOf(serviceWith(ordered))).toEqual([
      `endpoints.GET /a (alpha) success.body.x.at ${date} (also in endpoints.GET /z (zed))`,
    ]);
  });

  test('a def of a Definitions Package says where it is declared', () => {
    const tree = dateTree();
    const installed = anInstalledPackage(defineDefinitions({}), { tree });
    const endpoints = [anEndpoint('alpha', 'GET /a', { t: tree })];

    expect(linesOf(serviceWith(endpoints), { packages: [installed] })).toEqual([
      `endpoints.GET /a (alpha) success.body.t.at ${date} (declared in @org/definitions@4.2.0#tree)`,
    ]);
  });
});

describe('failure lines: an open union or intersection, reached from several sites', () => {
  test('a union shared by three Endpoints is one line naming the other two', () => {
    const choice = z.union([openEnum(['a', 'b']), z.number()]);
    const endpoints = ['c', 'a', 'b'].map((key) => anEndpoint(key, `GET /${key}`, { u: choice }));

    expect(linesOf(serviceWith(endpoints))).toEqual([
      `endpoints.GET /a (a) success.body.u ${unionIsRefused} (also in endpoints.GET /b (b), endpoints.GET /c (c))`,
    ]);
  });

  test('a union in a def used by two Endpoints is one line at the first Endpoint, never at the def', () => {
    const tree: z.ZodType = z
      .object({
        k: z.union([openEnum(['a']), z.number()]),
        get children() {
          return z.array(tree);
        },
      })
      .meta({ id: 'tree' });
    const endpoints = [
      anEndpoint('zed', 'GET /z', { t: tree }),
      anEndpoint('alpha', 'GET /a', { t: tree }),
    ];

    expect(linesOf(serviceWith(endpoints))).toEqual([
      `endpoints.GET /a (alpha) success.body.t.k ${unionIsRefused} (also in endpoints.GET /z (zed))`,
    ]);
  });

  test('an intersection shared by two Endpoints is one line naming the other', () => {
    const both = z.intersection(
      z.object({ status: openEnum(['a']) }),
      z.record(z.string(), z.json()),
    );
    const endpoints = [
      anEndpoint('alpha', 'GET /a', { b: both }),
      anEndpoint('zed', 'GET /z', { b: both }),
    ];

    expect(linesOf(serviceWith(endpoints))).toEqual([
      'endpoints.GET /a (alpha) success.body.b not allowed: an intersection that is not of open objects reaching an openEnum() (use .extend()) (also in endpoints.GET /z (zed))',
    ]);
  });
});

describe('failure lines: the variants of a discriminated union', () => {
  test('two variants whose discriminator is no literal give a line each', () => {
    const shape = z.discriminatedUnion('type', [
      z.object({ type: z.string() }),
      z.object({ type: z.string(), x: z.number() }),
    ]);

    const lines = linesOf(serviceWith([anEndpoint('alpha', 'GET /a', { s: shape })]));

    expect(lines).toEqual([
      'endpoints.GET /a (alpha) success.body.s<|0> not allowed: a discriminated union variant whose discriminator is not a literal',
      'endpoints.GET /a (alpha) success.body.s<|1> not allowed: a discriminated union variant whose discriminator is not a literal',
    ]);
  });

  test('two variants with one discriminator value, each refused, give a line each', () => {
    const shape = z.discriminatedUnion('t', [
      z.object({ t: z.literal('a'), v: z.date() }),
      z.object({ t: z.literal('a'), v: z.date() }),
    ]);

    const lines = linesOf(serviceWith([anEndpoint('alpha', 'GET /a', { x: shape })]));

    const dateAtVariant = `endpoints.GET /a (alpha) success.body.x<t="a">.v ${date}`;
    expect(lines.filter((line) => line === dateAtVariant)).toHaveLength(2);
  });
});

/** What a draw of the random test may put in a body, each a schema with refused constructs. */
type Pool = readonly (readonly [string, z.ZodType])[];

function poolOf(): Pool {
  const tree = dateTree();
  const inner: z.ZodType = z
    .object({
      at: z.date(),
      get children() {
        return z.array(inner);
      },
    })
    .meta({ id: 'inner' });
  const outer: z.ZodType = z
    .object({
      i: inner,
      get more() {
        return z.array(outer);
      },
    })
    .meta({ id: 'outer' });
  const category: z.ZodType = z.object({
    get children() {
      return z.array(category);
    },
  });
  return [
    ['date', z.date()],
    ['default', z.string().default('a')],
    ['any', z.any()],
    ['tree', tree],
    ['inner', inner],
    ['outer', outer],
    ['category', category],
    ['union', z.union([openEnum(['a']), z.number()])],
    ['both', z.intersection(z.object({ s: openEnum(['a']) }), z.record(z.string(), z.json()))],
    [
      'literal',
      z.discriminatedUnion('t', [
        z.object({ t: z.literal('a'), v: z.date() }),
        z.object({ t: z.literal('a'), v: z.date() }),
      ]),
    ],
    [
      'open',
      z.discriminatedUnion('type', [
        z.object({ type: z.string() }),
        z.object({ type: z.string(), x: z.number() }),
      ]),
    ],
  ];
}

/** One body of a draw: the pool's schemas it holds, each under the name it has in the pool. */
function fieldsOf(pool: Pool, next: () => number): Readonly<Record<string, z.ZodType>> {
  return Object.fromEntries(pool.filter(() => next() < 0.35));
}

describe('failure lines: shared refused schemas, drawn at random', () => {
  test.for([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20])(
    'draw %i: each declaration is told for what it holds, once, whatever the order',
    (seed) => {
      const next = seededNext(seed);
      const pool = poolOf();
      const endpoints = Array.from({ length: 1 + Math.floor(next() * 5) }, (_, index) =>
        anEndpoint(`e${index}`, `GET /e${index}`, fieldsOf(pool, next)),
      );
      const events = Array.from({ length: Math.floor(next() * 4) }, (_, index) =>
        anEvent(`Event${String.fromCharCode(65 + index)}`, fieldsOf(pool, next)),
      );

      const lines = linesOf(serviceWith(endpoints, events));
      const reversed = linesOf(serviceWith([...endpoints].reverse(), [...events].reverse()));

      expectToCoverAlone([...endpoints, ...events], lines);
      expect(lines.filter((line) => line.startsWith('defs.'))).toEqual([]);
      expect([...reversed].sort()).toEqual([...lines].sort());
    },
  );
});

/** A declaration's site as its lines name it, such as `endpoints.GET /e0 (e0)`. */
function siteOf(declaration: Endpoint | Event): string {
  if ('method' in declaration) {
    return `endpoints.${declaration.method} ${declaration.path} (${declaration.name})`;
  }
  return `events.${declaration.name}@${declaration.version}`;
}

/**
 * Every construct a declaration alone is told for, as many times as it is told, is told for it
 * in the lines of all of them, at its site first or after `also in`; and no line names a site twice.
 */
function expectToCoverAlone(declarations: readonly (Endpoint | Event)[], lines: readonly string[]) {
  for (const declaration of declarations) {
    const site = siteOf(declaration);
    const events = 'method' in declaration ? [] : [declaration];
    const endpoints = 'method' in declaration ? [declaration] : [];
    const alone = linesOf(serviceWith(endpoints, events));
    for (const construct of new Set(alone.map(constructOf))) {
      const told = alone.filter((line) => constructOf(line) === construct).length;
      const covering = lines.filter(
        (line) => constructOf(line) === construct && namesSite(line, site),
      );
      expect(covering.length).toBeGreaterThanOrEqual(told);
    }
  }
  for (const line of lines) {
    const sites = sitesOf(line);
    expect(new Set(sites).size).toBe(sites.length);
  }
}

/** The construct a `not allowed` line refuses, without where or the sites that also reach it. */
function constructOf(line: string): string {
  const [, refused = line] = line.split(' not allowed: ');
  return refused.replace(/ \(also in .*$/, '').replace(/ \(declared in .*$/, '');
}

function namesSite(line: string, site: string): boolean {
  return sitesOf(line).includes(site);
}

/** The sites a line names: where it sits, then each site after `also in`. */
function sitesOf(line: string): readonly string[] {
  const [head = '', tail = ''] = line.split(' not allowed: ');
  const first = /^(?<site>(?:endpoints\.\S+ \S+ \(\S+\)|events\.\S+))/.exec(head)?.groups?.['site'];
  const also = /\(also in (?<sites>.*?)\)(?: \(declared in |$)/.exec(tail)?.groups?.['sites'];
  const others = also === undefined ? [] : also.split(/, (?=endpoints\.|events\.)/);
  return first === undefined ? others : [first, ...others];
}
