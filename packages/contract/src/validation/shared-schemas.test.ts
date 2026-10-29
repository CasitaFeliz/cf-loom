import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { cpuMillisecondsOf, growthOf } from '../../test/growth.ts';
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

/**
 * How much longer a shape may take at eight times the size: three times the growth of the size.
 * Linear code measures 7 to 14 times longer, in whole runs of this file and of the project on busy
 * cores, and when the CPU time is read in ticks of 10 ms; the quadratic code these tests were
 * written for measures 48 times or more.
 */
const linearGrowth = 24;

/**
 * A growth test builds and times its shape up to three times over, which takes up to 11 s while the
 * project's files run in parallel, and several times that on a CI runner that several runs share.
 */
const growthTimeout = 240_000;

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

  test('a cycle no id names is a line at each site that meets it', () => {
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
      'endpoints.GET /z (zed) success.body.c.children[] not allowed: a cycle without .meta({ id }) (use .meta({ id }))',
      'endpoints.GET /a (alpha) success.body.l.c.children[] not allowed: a cycle without .meta({ id }) (use .meta({ id }))',
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
      const tell = () => linesOf(serviceWith([endpoint]));

      const lines = tell();
      const cpuMilliseconds = cpuMillisecondsOf(tell, 2000);

      expect(lines).toEqual(told);
      expect(cpuMilliseconds).toBeLessThan(2000);
    },
  );
});

/** An Endpoint named `name` at a route such as `GET /things`, answering the body given. */
function answering(name: string, route: string, body: z.ZodType) {
  const [method, path] = route.split(' ');
  return defineEndpoint({
    name,
    method,
    path,
    visibility: 'public',
    description: 'd',
    success: { status: 200, body },
  } as never);
}

const unnamedCycle = 'not allowed: a cycle without .meta({ id }) (use .meta({ id }))';

describe('failure lines: a cycle of two schemas no id names', () => {
  /** `a` holding `b`, and `b` holding `a`, itself again and a date, its fields in the order given. */
  function cycleOf(order: 'a first' | 'date first', depth: 'shallow' | 'deep') {
    const first: z.ZodType = z.object({
      get b() {
        return second;
      },
    });
    const second: z.ZodType = secondOf(first, () => second, { order, depth });
    return { first, second };
  }

  /** The second schema, its getters written out, since a spread would call them. */
  function secondOf(
    first: z.ZodType,
    itself: () => z.ZodType,
    shape: { readonly order: 'a first' | 'date first'; readonly depth: 'shallow' | 'deep' },
  ): z.ZodType {
    if (shape.depth === 'deep') {
      return z.object({
        get a() {
          return first;
        },
        w: z.object({
          x: z.object({
            get b2() {
              return itself();
            },
          }),
        }),
        d: z.object({ e: z.date() }),
      });
    }
    if (shape.order === 'date first') {
      return z.object({
        d: z.date(),
        get a() {
          return first;
        },
        get b2() {
          return itself();
        },
      });
    }
    return z.object({
      get a() {
        return first;
      },
      get b2() {
        return itself();
      },
      d: z.date(),
    });
  }

  test.for([
    ['a first', 'shallow', ['b.a', 'b.d']],
    ['a first', 'deep', ['b.a', 'b.d.e']],
    ['date first', 'shallow', ['b.d', 'b.a']],
  ] as const)(
    'entered again inside its own walk, its fields %s and %s, tells each where it is',
    ([order, depth, [earlier, later]]) => {
      const { first } = cycleOf(order, depth);

      const lines = linesOf(serviceWith([answering('alpha', 'GET /a', first)]));

      const at = (path: string) => `endpoints.GET /a (alpha) success.body.${path}`;
      const told = { 'b.a': unnamedCycle, 'b.d': date, 'b.d.e': date };
      expect(lines).toEqual([`${at(earlier)} ${told[earlier]}`, `${at(later)} ${told[later]}`]);
    },
  );

  test.for([
    ['a', 'b'],
    ['b', 'a'],
  ] as const)(
    'with its other schema at an Endpoint, declared %s first, tells the cycle where each meets it',
    (order) => {
      const { first, second } = cycleOf('a first', 'deep');
      const endpoints = {
        a: answering('alpha', 'GET /a', first),
        b: anEndpoint('beta', 'GET /b', { q: second }),
      };

      const lines = linesOf(serviceWith(order.map((key) => endpoints[key])));

      expect([...lines].sort()).toEqual([
        `endpoints.GET /a (alpha) success.body.b.a ${unnamedCycle}`,
        `endpoints.GET /a (alpha) success.body.b.d.e ${date} (also in endpoints.GET /b (beta))`,
        `endpoints.GET /b (beta) success.body.q.a.b ${unnamedCycle}`,
      ]);
    },
  );

  test.for([
    ['a first', 'b.a'],
    ['the def first', 'b.c.back.b.a'],
  ] as const)(
    'holding a def that reaches back, its fields %s, tells the cycle where it closes',
    ([order, path]) => {
      const first: z.ZodType = z.object({
        get b() {
          return second;
        },
      });
      const second: z.ZodType =
        order === 'a first'
          ? z.object({
              get a() {
                return first;
              },
              get c() {
                return held;
              },
            })
          : z.object({
              get c() {
                return held;
              },
              get a() {
                return first;
              },
            });
      const held: z.ZodType = z
        .object({
          get back() {
            return first;
          },
          get kids() {
            return z.array(held);
          },
        })
        .meta({ id: 'c' });

      const lines = linesOf(serviceWith([answering('alpha', 'GET /a', first)]));

      expect(lines).toEqual([`endpoints.GET /a (alpha) success.body.${path} ${unnamedCycle}`]);
    },
  );

  test.for([
    ['the cycle', 'the def'],
    ['the def', 'the cycle'],
  ] as const)(
    'reached through a def another declaration holds, declared %s first, is told as each declaration alone tells it',
    (order) => {
      const { cycle, def } = cycleThroughDef();
      const declarations = {
        'the cycle': answering('alpha', 'GET /a', cycle),
        'the def': answering('gamma', 'GET /c', def),
      };
      const ordered = order.map((key) => declarations[key]);

      const lines = linesOf(serviceWith(ordered));

      const alone = ordered.flatMap((declaration) => linesOf(serviceWith([declaration])));
      expect(cycleLinesOf(lines)).toEqual(cycleLinesOf(alone));
    },
  );
});

/** The lines that refuse a cycle no id names, in code point order. */
function cycleLinesOf(lines: readonly string[]): readonly string[] {
  return lines.filter((line) => line.includes(unnamedCycle)).sort();
}

/** `cycle` holding `second`, which holds the def `def` before `cycle` again; `def` holds a date and reaches back to `cycle`. */
function cycleThroughDef() {
  const cycle: z.ZodType = z.object({
    get b() {
      return second;
    },
  });
  const second: z.ZodType = z.object({
    get c() {
      return def;
    },
    get a() {
      return cycle;
    },
  });
  const def: z.ZodType = z
    .object({
      when: z.date(),
      get back() {
        return cycle;
      },
      get kids() {
        return z.array(def);
      },
    })
    .meta({ id: 'c' });
  return { cycle, def };
}

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

/** A cycle of two schemas no id names, the second holding a leaf and itself again: both, for declarations to enter at either. */
function anUnnamedPair(next: Next): readonly z.ZodType[] {
  const first: z.ZodType = z.object({
    get b() {
      return second;
    },
  });
  const second: z.ZodType = z.object({
    get a() {
      return first;
    },
    get b2() {
      return second;
    },
    d: aLeaf(next),
  });
  return [first, z.object({ q: second })];
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
  const drawn = Array.from({ length: 1 + Math.floor(next() * 3) }, () => pickOf(next, makers)());
  const withPair = next() < 0.5 ? [...drawn, ...anUnnamedPair(next)] : drawn;
  if (next() < 0.5) {
    return withPair;
  }
  const { cycle, def } = cycleThroughDef();
  return [...withPair, cycle, def];
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

/** A line naming the declaration's site, so its site reads as `sitesOf` reads a line's. */
function lineAt(declaration: Endpoint | Event): string {
  const site = isEndpoint(declaration)
    ? `endpoints.${declaration.method} ${declaration.path} (${declaration.name})`
    : `events.${declaration.name}@${declaration.version}`;
  return `${site} not allowed: `;
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

  test.for(seeds)('draw %i: each line sits where its first site alone tells it', (seed) => {
    const declarations = declarationsOf(seed);

    const lines = refusedLinesOf(rootOf(declarations));

    const misplaced = lines.filter((line) => {
      const [first] = sitesOf(line);
      const declaration = declarations.find((candidate) =>
        sitesOf(lineAt(candidate)).includes(first ?? ''),
      );
      const alone = declaration === undefined ? [] : refusedLinesOf(rootOf([declaration]));
      return !alone.map(textOf).includes(textOf(line));
    });
    expect(misplaced).toEqual([]);
  });

  test.for(seeds)('draw %i: each cycle line is one its declaration alone prints', (seed) => {
    const declarations = declarationsOf(seed);

    const lines = linesOf(rootOf(declarations));

    const alone = declarations.flatMap((declaration) => linesOf(rootOf([declaration])));
    expect(cycleLinesOf(lines)).toEqual(cycleLinesOf(alone));
  });

  test.for(seeds)('draw %i: no line sits at a def', (seed) => {
    const lines = refusedLinesOf(rootOf(declarationsOf(seed)));

    expect(lines.filter((line) => line.startsWith('defs.'))).toEqual([]);
  });
});

describe('failure lines: defs reached inside one another and from the body', () => {
  /** Defs `d0` to `d(count - 1)`, each holding the next and itself, a date in the last. */
  function chainedDefs(count: number): readonly z.ZodType[] {
    const defs: z.ZodType[] = [];
    for (let index = 0; index < count; index++) {
      const id = `d${index}`;
      const self = () => z.array(defs[index] as z.ZodType);
      const link = () => defs[index + 1] as z.ZodType;
      defs.push(
        index === count - 1
          ? z
              .object({
                at: z.date(),
                get self() {
                  return self();
                },
              })
              .meta({ id })
          : z
              .object({
                get next() {
                  return link();
                },
                get self() {
                  return self();
                },
              })
              .meta({ id }),
      );
    }
    return defs;
  }

  /** An Endpoint whose body has each of `count` chained defs as a field, the last of them first. */
  function chainedRoot(count: number): Root {
    const defs = chainedDefs(count);
    const fields: Record<string, z.ZodType> = {};
    for (let index = count - 1; index >= 0; index--) {
      fields[`f${String(index).padStart(5, '0')}`] = defs[index] as z.ZodType;
    }
    return serviceWith([anEndpoint('alpha', 'GET /a', fields)]);
  }

  test('a date in the last of 2,400 defs is one line at the first place, in time that grows as the defs do', {
    timeout: growthTimeout,
  }, () => {
    const count = 2400;
    const told = (size: number) => {
      const root = chainedRoot(size);
      return () => linesOf(root);
    };

    const growth = growthOf(told, { small: count / 8, large: count }, linearGrowth);
    const lines = told(count)();

    const firstPlace = `success.body.f00000${'.next'.repeat(count - 1)}.at`;
    expect(lines).toEqual([`endpoints.GET /a (alpha) ${firstPlace} ${date}`]);
    expect(growth).toBeLessThan(linearGrowth);
  });

  /** An Endpoint whose body has a def of `count` fields holding the same dated def. */
  function heldRoot(count: number): Root {
    const held: z.ZodType = z
      .object({
        at: z.date(),
        get self() {
          return z.array(held);
        },
      })
      .meta({ id: 'held' });
    const fields: Record<string, z.ZodType> = {};
    for (let index = 0; index < count; index++) {
      fields[`f${String(index).padStart(6, '0')}`] = held;
    }
    const holder: z.ZodType = z
      .object({
        ...fields,
        get self() {
          return z.array(holder);
        },
      })
      .meta({ id: 'holder' });
    return serviceWith([anEndpoint('alpha', 'GET /a', { holder })]);
  }

  test('a date in a def held by 32,000 fields of another def is one line at the first, in time that grows as the fields do', {
    timeout: growthTimeout,
  }, () => {
    const count = 32000;
    const told = (size: number) => {
      const root = heldRoot(size);
      return () => linesOf(root);
    };

    const growth = growthOf(told, { small: count / 8, large: count }, linearGrowth);
    const lines = told(count)();

    expect(lines).toEqual([`endpoints.GET /a (alpha) success.body.holder.f000000.at ${date}`]);
    expect(growth).toBeLessThan(linearGrowth);
  });

  /** An Endpoint whose body has `count` dated defs as fields, each holding the one before it. */
  function datedChainRoot(count: number): Root {
    const fields: Record<string, z.ZodType> = {};
    let before: z.ZodType | undefined;
    for (let index = 0; index < count; index++) {
      const previous = before;
      const def: z.ZodType = z
        .object({
          at: z.date(),
          ...(previous && { previous }),
          get self() {
            return z.array(def);
          },
        })
        .meta({ id: `c${index}` });
      fields[`c${String(index).padStart(6, '0')}`] = def;
      before = def;
    }
    return serviceWith([anEndpoint('alpha', 'GET /a', fields)]);
  }

  test('3,000 dated defs, each holding the one before and a field of the body, told in time that grows as they do', {
    timeout: growthTimeout,
  }, () => {
    const count = 3000;
    const told = (size: number) => {
      const root = datedChainRoot(size);
      return () => linesOf(root);
    };

    const growth = growthOf(told, { small: count / 8, large: count }, linearGrowth);
    const lines = told(count)();

    expect(lines).toHaveLength(count);
    expect(lines[0]).toBe(`endpoints.GET /a (alpha) success.body.c000000.at ${date}`);
    expect(lines.at(-1)).toBe(`endpoints.GET /a (alpha) success.body.c002999.at ${date}`);
    expect(growth).toBeLessThan(linearGrowth);
  });
});

describe('failure lines: many dated defs that one def holds, reached from many fields', () => {
  /** A way a field holds the def that holds the dated defs: `hub` as it is, or inside something. */
  type Holding = (hub: z.ZodType, index: number) => z.ZodType;

  /**
   * An Endpoint whose body has `count` dated defs and a def holding them all, each as fields, and
   * `count` more fields holding that def.
   */
  function hubRoot(count: number, holding: Holding = (hub) => hub): Root {
    const dated: z.ZodType[] = [];
    for (let index = 0; index < count; index++) {
      const def: z.ZodType = z
        .object({
          at: z.date(),
          get self() {
            return z.array(def);
          },
        })
        .meta({ id: `d${index}` });
      dated.push(def);
    }
    const held: Record<string, z.ZodType> = {};
    for (let index = 0; index < count; index++) {
      held[`h${String(index).padStart(6, '0')}`] = dated[index] as z.ZodType;
    }
    const hub: z.ZodType = z
      .object({
        ...held,
        get self() {
          return z.array(hub);
        },
      })
      .meta({ id: 'hub' });
    const fields: Record<string, z.ZodType> = {};
    for (let index = 0; index < count; index++) {
      fields[`a${String(index).padStart(6, '0')}`] = dated[index] as z.ZodType;
      fields[`z${String(index).padStart(6, '0')}`] = holding(hub, index);
    }
    return serviceWith([anEndpoint('alpha', 'GET /a', fields)]);
  }

  test('3,000 dated defs, each a field of the body and of a def that 3,000 fields hold, told in time that grows as they do', {
    timeout: growthTimeout,
  }, () => {
    const count = 3000;
    const told = (size: number) => {
      const root = hubRoot(size);
      return () => linesOf(root);
    };

    const growth = growthOf(told, { small: count / 8, large: count }, linearGrowth);
    const lines = told(count)();

    expect(lines).toHaveLength(count);
    expect(lines[0]).toBe(`endpoints.GET /a (alpha) success.body.a000000.at ${date}`);
    expect(lines.at(-1)).toBe(`endpoints.GET /a (alpha) success.body.a002999.at ${date}`);
    expect(growth).toBeLessThan(linearGrowth);
  });

  const holdings: readonly (readonly [string, Holding])[] = [
    ['in an array', (hub) => z.array(hub)],
    ['as optional', (hub) => hub.optional()],
    [
      'through a def of their own',
      (hub, index) => {
        const own: z.ZodType = z
          .object({
            hub,
            get self() {
              return z.array(own);
            },
          })
          .meta({ id: `w${index}` });
        return own;
      },
    ],
  ];

  test.for(holdings)(
    '3,000 dated defs, each a field of the body and of a def that 3,000 fields hold %s, told in time that grows as they do',
    {
      timeout: growthTimeout,
    },
    ([, holding]) => {
      const count = 3000;
      const told = (size: number) => {
        const root = hubRoot(size, holding);
        return () => linesOf(root);
      };

      const growth = growthOf(told, { small: count / 8, large: count }, linearGrowth);
      const lines = told(count)();

      expect(lines).toHaveLength(count);
      expect(lines[0]).toBe(`endpoints.GET /a (alpha) success.body.a000000.at ${date}`);
      expect(lines.at(-1)).toBe(`endpoints.GET /a (alpha) success.body.a002999.at ${date}`);
      expect(growth).toBeLessThan(linearGrowth);
    },
  );

  /** `count` Endpoints, each with the same dated def as a field of its body. */
  function endpointsRoot(count: number): Root {
    const def: z.ZodType = z
      .object({
        at: z.date(),
        get self() {
          return z.array(def);
        },
      })
      .meta({ id: 'd' });
    const endpoints = Array.from({ length: count }, (_, index) =>
      anEndpoint(`e${String(index).padStart(6, '0')}`, `GET /e${index}`, { def }),
    );
    return serviceWith(endpoints);
  }

  test('a dated def that 4,000 Endpoints hold is one line naming every other Endpoint, in time that grows as the Endpoints do', {
    timeout: growthTimeout,
  }, () => {
    const count = 4000;
    const told = (size: number) => {
      const root = endpointsRoot(size);
      return () => linesOf(root);
    };

    const growth = growthOf(told, { small: count / 8, large: count }, linearGrowth);
    const lines = told(count)();

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(
      new RegExp(
        `^endpoints.GET /e0 \\(e000000\\) success.body.def.at ${date.replaceAll(/[().]/g, '\\$&')} \\(also in endpoints.GET /e1 \\(e000001\\), `,
      ),
    );
    expect(lines[0]?.split('endpoints.')).toHaveLength(count + 1);
    expect(growth).toBeLessThan(linearGrowth);
  });

  /** An Endpoint whose body has `count` dated defs of their own, beside `count` Endpoints with none. */
  function datedBesidePlainRoot(count: number): Root {
    const dated: Record<string, z.ZodType> = {};
    for (let index = 0; index < count; index++) {
      const def: z.ZodType = z
        .object({
          at: z.date(),
          get self() {
            return z.array(def);
          },
        })
        .meta({ id: `d${index}` });
      dated[`d${String(index).padStart(6, '0')}`] = def;
    }
    const plain = Array.from({ length: count }, (_, index) =>
      anEndpoint(`e${String(index + 1).padStart(6, '0')}`, `GET /e${index + 1}`, { s: z.string() }),
    );
    return serviceWith([anEndpoint('e000000', 'GET /e0', dated), ...plain]);
  }

  test('16,000 dated defs of one Endpoint, beside 16,000 Endpoints with none, are one line each, in time that grows as they do', {
    timeout: growthTimeout,
  }, () => {
    const count = 16000;
    const told = (size: number) => {
      const root = datedBesidePlainRoot(size);
      return () => linesOf(root);
    };

    const growth = growthOf(told, { small: count / 8, large: count }, linearGrowth);
    const lines = told(count)();

    expect(lines).toHaveLength(count);
    expect(lines[0]).toBe(`endpoints.GET /e0 (e000000) success.body.d000000.at ${date}`);
    expect(lines.at(-1)).toBe(`endpoints.GET /e0 (e000000) success.body.d015999.at ${date}`);
    expect(growth).toBeLessThan(linearGrowth);
  });
});

describe('failure lines: a def held by a def of a Definitions Package, exported', () => {
  test.for([
    ['outer-x written first', ['outer-x', 'outer']],
    ['outer written first', ['outer', 'outer-x']],
  ] as const)('a date in the held def is told at the holding def, with %s', ([, order]) => {
    const inner: z.ZodType = z
      .object({
        at: z.date(),
        get kids() {
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
    const exported = { 'outer-x': z.object({ i: inner }), outer };
    const rootExports = Object.fromEntries(order.map((name) => [name, exported[name]]));

    const lines = linesOf(defineDefinitions({}), { rootExports });

    expect(lines).toEqual([`exports.outer i.at ${date} (also in exports.outer-x)`]);
  });
});

/** A graph of defs: the edges each holds, the fields of the body, and the defs holding a date. */
type DefGraph = {
  readonly edges: readonly (readonly (readonly [string, number])[])[];
  readonly body: readonly (readonly [string, number])[];
  readonly dated: readonly number[];
};

/** Edges from a holder to some of the defs, each at a field of its own, named at random. */
function edgesTo(
  defs: readonly number[],
  chance: number,
  next: Next,
): readonly (readonly [string, number])[] {
  const names = shuffled('abcdefghijklmn'.split(''), next);
  const held = defs.filter(() => next() < chance);
  return held.map((def, index) => [names[index] as string, def]);
}

function defGraphOf(seed: number): DefGraph {
  const next = seededNext(seed);
  const count = 6 + Math.floor(next() * 7);
  const defs = Array.from({ length: count }, (_, index) => index);
  return {
    edges: defs.map((def) =>
      edgesTo(
        defs.filter((other) => other !== def),
        0.3,
        next,
      ),
    ),
    body: edgesTo(defs, 0.4, next),
    dated: defs.filter(() => next() < 0.4),
  };
}

/** Every def of the graph as a schema: each holds itself, its edges, and a date if it is dated. */
function defsOf(graph: DefGraph): readonly z.ZodType[] {
  const defs: z.ZodType[] = [];
  graph.edges.forEach((edges, index) => {
    const shape: Record<string, z.ZodType> = graph.dated.includes(index) ? { at: z.date() } : {};
    for (const [name, to] of edges) {
      Object.defineProperty(shape, name, { enumerable: true, get: () => defs[to] });
    }
    Object.defineProperty(shape, 'self', {
      enumerable: true,
      get: () => z.array(defs[index] as z.ZodType),
    });
    defs.push(z.object(shape).meta({ id: `d${index}` }));
  });
  return defs;
}

/** The line each dated def's date is told by: at the smallest text of the paths from the body. */
function firstPlaceLinesOf(graph: DefGraph): readonly string[] {
  const firstPlaceOf = new Map<number, string>();
  const visit = (def: number, text: string, visited: readonly number[]) => {
    const place = `${text}.at`;
    const known = firstPlaceOf.get(def);
    if (graph.dated.includes(def) && (known === undefined || place < known)) {
      firstPlaceOf.set(def, place);
    }
    for (const [name, to] of graph.edges[def] ?? []) {
      if (!visited.includes(to)) {
        visit(to, `${text}.${name}`, [...visited, to]);
      }
    }
  };
  for (const [name, to] of graph.body) {
    visit(to, `success.body.${name}`, [to]);
  }
  return [...firstPlaceOf.values()].map((place) => `endpoints.GET /a (alpha) ${place} ${date}`);
}

const graphSeeds = Array.from({ length: 400 }, (_, index) => index + 1);

describe('failure lines: dates in a graph of defs, drawn at random', () => {
  test.for(graphSeeds)(
    'draw %i: each date is told from the first place that reaches it',
    (seed) => {
      const graph = defGraphOf(seed);
      const defs = defsOf(graph);
      const fields: Record<string, z.ZodType> = {};
      for (const [name, to] of graph.body) {
        fields[name] = defs[to] as z.ZodType;
      }

      const lines = linesOf(serviceWith([anEndpoint('alpha', 'GET /a', fields)]));

      expect([...lines].sort()).toEqual([...firstPlaceLinesOf(graph)].sort());
    },
  );
});
