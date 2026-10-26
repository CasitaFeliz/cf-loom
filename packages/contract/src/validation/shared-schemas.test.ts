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

  test('two variants with one discriminator value, each refused, are one line beside the duplicate value', () => {
    const shape = z.discriminatedUnion('t', [
      z.object({ t: z.literal('a'), v: z.date() }),
      z.object({ t: z.literal('a'), v: z.date() }),
    ]);

    const lines = linesOf(serviceWith([anEndpoint('alpha', 'GET /a', { x: shape })]));

    expect(lines).toEqual([
      'endpoints.GET /a (alpha) success.body.x not allowed: two discriminated union variants with the same discriminator value',
      `endpoints.GET /a (alpha) success.body.x<t="a">.v ${date}`,
    ]);
  });
});

describe('failure lines: a construct stacked on itself', () => {
  test.for([
    ['z.set() of a z.set()', () => z.set(z.set(z.string())), 'z.set()'],
    ['a .pipe() into a .pipe()', () => z.string().pipe(z.string().pipe(z.string())), '.pipe()'],
    ['.transform() twice', () => z.string().transform(String).transform(String), '.transform()'],
    ['.default() twice', () => z.string().default('a').default('b'), '.default()'],
  ] as const)('%s is one line', ([, stacked, construct]) => {
    const endpoint = anEndpoint('alpha', 'GET /a', { v: stacked() });

    expect(linesOf(serviceWith([endpoint]))).toEqual([
      `endpoints.GET /a (alpha) success.body.v not allowed: ${construct}`,
    ]);
  });
});

describe('failure lines: defs that hold defs', () => {
  /** Two defs that hold each other, the date in one of them, and an Endpoint entering each. */
  function mutualPair() {
    const either: z.ZodType = z
      .object({
        x: z.date(),
        get d() {
          return other;
        },
      })
      .meta({ id: 'eDef' });
    const other: z.ZodType = z
      .object({
        get e() {
          return either;
        },
      })
      .meta({ id: 'dDef' });
    return {
      a: anEndpoint('a', 'GET /a', { d: other }),
      b: anEndpoint('b', 'GET /b', { e: either }),
    };
  }

  test.for([
    ['a', 'b'],
    ['b', 'a'],
  ] as const)('a date in one of two defs is told from the first place, declared %s', (order) => {
    const endpoints = mutualPair();

    const lines = linesOf(serviceWith(order.map((key) => endpoints[key])));

    expect(lines).toEqual([
      `endpoints.GET /a (a) success.body.d.e.x ${date} (also in endpoints.GET /b (b))`,
    ]);
  });

  /** A chain of defs, each holding the next at two fields, so a body reaches the last by 2^depth paths. */
  function chainOf(depth: number, leaf: z.ZodType): z.ZodType {
    let next = aDef(`d${depth}`, { leaf });
    for (let level = depth - 1; level >= 0; level -= 1) {
      next = aDef(`d${level}`, { a: next, b: next });
    }
    return next;
  }

  const levels = 24;
  const deepest = `success.body.t.${'a.'.repeat(levels)}leaf`;

  test.for([
    ['a valid union', () => z.union([z.string(), z.number()]), []],
    ['a date', () => z.date(), [`endpoints.GET /a (alpha) ${deepest} ${date}`]],
    [
      'an open union',
      () => z.union([openEnum(['x', 'y']), z.number()]),
      [`endpoints.GET /a (alpha) ${deepest} ${unionIsRefused}`],
    ],
  ] as const)(
    '%s in the last of 24 defs, each holding the next twice, is told once, quickly',
    ([, leaf, told]) => {
      const endpoint = anEndpoint('alpha', 'GET /a', { t: chainOf(levels, leaf()) });
      const started = performance.now();

      const lines = linesOf(serviceWith([endpoint]));

      expect(lines).toEqual(told);
      expect(performance.now() - started).toBeLessThan(2000);
    },
  );
});

type Next = () => number;

function pickOf<Value>(next: Next, values: readonly Value[]): Value {
  return values[Math.floor(next() * values.length)] as Value;
}

/** A leaf of the pool's schemas: refused, refused twice over, or allowed. */
function aLeaf(next: Next): z.ZodType {
  const leaves: readonly (() => z.ZodType)[] = [
    () => z.date(),
    () => z.string().default('x'),
    () => z.any(),
    () => z.string(),
    () => z.number(),
    () => z.set(z.set(z.string())),
    () => z.string().default('a').default('b'),
  ];
  return pickOf(next, leaves)();
}

function anOpenUnion(): z.ZodType {
  return z.union([openEnum(['a', 'b']), z.number()]);
}

/** A def with an id of its own, holding the fields given and a list of itself. */
function aDef(id: string, fields: Readonly<Record<string, z.ZodType>>): z.ZodType {
  const def: z.ZodType = z
    .object({
      ...fields,
      get kids() {
        return z.array(def);
      },
    })
    .meta({ id });
  return def;
}

/** A variant of a discriminated union, its discriminator a literal or refused, holding a leaf. */
function aVariant(next: Next): z.ZodObject {
  const discriminator = next() < 0.5 ? z.string() : z.literal(pickOf(next, ['a', 'b']));
  return z.object({ t: discriminator, v: aLeaf(next) });
}

/** Two defs that hold each other, entered at either. */
function aMutualPair(next: Next, id: string): z.ZodType {
  const either: z.ZodType = z
    .object({
      x: aLeaf(next),
      get d() {
        return other;
      },
    })
    .meta({ id: `${id}e` });
  const other: z.ZodType = z
    .object({
      get e() {
        return either;
      },
    })
    .meta({ id });
  return next() < 0.5 ? other : either;
}

/** A def held by another def, entered at either. */
function nestedDefs(next: Next, id: string): z.ZodType {
  const inner = aDef(`${id}i`, { at: aLeaf(next) });
  const outer = aDef(id, { i: inner });
  return next() < 0.5 ? outer : inner;
}

/** A cycle no id names. */
function anUnnamedCycle(): z.ZodType {
  const cycle: z.ZodType = z.object({
    get self() {
      return z.array(cycle);
    },
  });
  return cycle;
}

/** What the declarations of a draw share: 1 to 3 schemas, each holding refused constructs. */
function poolOf(next: Next): readonly z.ZodType[] {
  const idOf = (prefix: string) => `${prefix}${Math.floor(next() * 1e6)}`;
  const makers: readonly (() => z.ZodType)[] = [
    () => z.object({ a: aLeaf(next), b: aLeaf(next) }),
    () => z.object({ k: anOpenUnion() }),
    () => z.object({ k: z.union([anOpenUnion(), z.string()]) }),
    () => z.discriminatedUnion('t', [aVariant(next), aVariant(next)]),
    () => aDef(idOf('d'), { at: aLeaf(next) }),
    () => aDef(idOf('u'), { k: anOpenUnion() }),
    () => aDef(idOf('s'), { k: z.set(z.set(aLeaf(next))) }),
    anUnnamedCycle,
    () => nestedDefs(next, idOf('n')),
    () => aMutualPair(next, idOf('m')),
    () => {
      const def = aDef(idOf('g'), { at: aLeaf(next) });
      return z.object({ p: def, q: def });
    },
  ];
  return Array.from({ length: 1 + Math.floor(next() * 3) }, () => pickOf(next, makers)());
}

/** A body of a draw: a schema of the pool or one of its own, as is or wrapped. */
function aBody(next: Next, pool: readonly z.ZodType[]): z.ZodType {
  const drawn = next() < 0.75 ? pickOf(next, pool) : z.object({ fresh: z.date() });
  const wrappings: readonly ((schema: z.ZodType) => z.ZodType)[] = [
    (schema) => schema,
    (schema) => z.object({ w: schema }),
    (schema) => z.object({ p: schema, q: schema }),
    (schema) => z.array(schema),
  ];
  return pickOf(next, wrappings)(drawn);
}

/** The declarations of a draw: 1 to 5 Endpoints and 0 to 3 Events, their bodies sharing a pool. */
function declarationsOf(seed: number): readonly (Endpoint | Event)[] {
  const next = seededNext(seed);
  const pool = poolOf(next);
  const endpoints = Array.from({ length: 1 + Math.floor(next() * 5) }, (_, index) =>
    defineEndpoint({
      name: `e${index}`,
      method: 'GET',
      path: `/e${index}`,
      visibility: 'public',
      description: 'd',
      success: { status: 200, body: aBody(next, pool) },
    } as never),
  );
  const events = Array.from({ length: Math.floor(next() * 4) }, (_, index) =>
    defineEvent({
      name: `Ev${index}`,
      version: 1,
      visibility: 'internal',
      description: 'E',
      body: aBody(next, pool),
    } as never),
  );
  return [...endpoints, ...events];
}

function rootOf(declarations: readonly (Endpoint | Event)[]): Root {
  return serviceWith(declarations.filter(isEndpoint), declarations.filter(isEvent));
}

function isEndpoint(declaration: Endpoint | Event): declaration is Endpoint {
  return 'method' in declaration;
}

function isEvent(declaration: Endpoint | Event): declaration is Event {
  return !('method' in declaration);
}

/** The `not allowed` lines `generate` prints for a Root. */
function refusedLinesOf(root: Root): readonly string[] {
  return linesOf(root).filter((line) => line.includes(' not allowed: '));
}

/** A line without the sites that also reach it and the origin: what it says, once. */
function textOf(line: string): string {
  return line.replace(/ \((also in|declared in) .*$/, '');
}

function constructOf(line: string): string {
  return textOf(line).replace(/^.*? not allowed: /, '');
}

const siteNames = /endpoints\.(GET \/e\d+) \(e\d+\)|events\.(Ev\d+@1)|(defs\.\w+)/g;

/** The sites a line names: where it sits, then each site after `also in`. */
function sitesOf(line: string): readonly string[] {
  const [head = ''] = line.split(' not allowed: ');
  const also = /\(also in (?<sites>.*?)\)(?: \(declared in |$)/.exec(line)?.groups?.['sites'] ?? '';
  return [...head.matchAll(siteNames), ...also.matchAll(siteNames)].map(
    ([, endpoint, event, def]) => endpoint ?? event ?? def ?? '',
  );
}

/** How many times the lines tell each construct at each site. */
function toldCountsOf(lines: readonly string[]): Readonly<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const line of lines) {
    for (const site of sitesOf(line)) {
      const key = `${site} | ${constructOf(line)}`;
      counts[key] = (counts[key] ?? 0) + 1;
    }
  }
  return counts;
}

function shuffled<Item>(items: readonly Item[], next: Next): readonly Item[] {
  const shuffledItems = [...items];
  for (let index = shuffledItems.length - 1; index > 0; index -= 1) {
    const other = Math.floor(next() * (index + 1));
    [shuffledItems[index], shuffledItems[other]] = [
      shuffledItems[other] as Item,
      shuffledItems[index] as Item,
    ];
  }
  return shuffledItems;
}

const seeds = Array.from({ length: 200 }, (_, index) => index + 1);

describe('failure lines: shared refused schemas, drawn at random', () => {
  test.for(seeds)('draw %i: the lines tell each site what it alone is told', (seed) => {
    const declarations = declarationsOf(seed);

    const lines = refusedLinesOf(rootOf(declarations));

    const alone = declarations.flatMap((declaration) => refusedLinesOf(rootOf([declaration])));
    expect(toldCountsOf(lines)).toEqual(toldCountsOf(alone));
  });

  test.for(seeds)('draw %i: no line names a site twice, and no two lines say one thing', (seed) => {
    const lines = refusedLinesOf(rootOf(declarationsOf(seed)));

    const twice = lines.filter((line) => new Set(sitesOf(line)).size !== sitesOf(line).length);
    expect({ twice, texts: new Set(lines.map(textOf)).size }).toEqual({
      twice: [],
      texts: lines.length,
    });
  });

  test.for(seeds)('draw %i: the order of the declarations changes no line', (seed) => {
    const declarations = declarationsOf(seed);

    const lines = refusedLinesOf(rootOf(declarations));

    const reordered = refusedLinesOf(rootOf(shuffled(declarations, seededNext(seed * 7 + 1))));
    expect([...reordered].sort()).toEqual([...lines].sort());
  });

  test.for(seeds)('draw %i: no line sits at a def', (seed) => {
    const lines = refusedLinesOf(rootOf(declarationsOf(seed)));

    expect(lines.filter((line) => line.startsWith('defs.'))).toEqual([]);
  });
});
