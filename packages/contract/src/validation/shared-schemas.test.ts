import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { growthOf } from '../../test/growth.ts';
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

  test('a union that is the last field of a def used by two Endpoints is one line at the first Endpoint, never at the def', () => {
    const tree: z.ZodType = z
      .object({
        get children() {
          return z.array(tree);
        },
        k: z.union([openEnum(['a']), z.number()]),
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
  /**
   * How many times longer a chain twice as deep may take to tell: about 2 when each def is told
   * once, and 2 to the power of its length when each of the paths to it tells it afresh.
   */
  const toldOnceGrowth = 8;

  test.for([
    ['a valid union', () => z.union([z.string(), z.number()]), []],
    ['a date', () => z.date(), [`endpoints.GET /a (alpha) ${deepest} ${date}`]],
    [
      'an open union',
      () => z.union([openEnum(['x', 'y']), z.number()]),
      [`endpoints.GET /a (alpha) ${deepest} ${unionIsRefused}`],
    ],
  ] as const)(
    '%s in the last of 24 defs, each holding the next twice, is told once',
    { timeout: growthTimeout },
    ([, leaf, told]) => {
      const toldAt = (depth: number) => {
        const endpoint = anEndpoint('alpha', 'GET /a', { t: chainOf(depth, leaf()) });
        return () => linesOf(serviceWith([endpoint]));
      };

      const lines = toldAt(levels)();
      const growth = growthOf(toldAt, { small: 8, large: 16 }, toldOnceGrowth);

      expect(lines).toEqual(told);
      expect(growth).toBeLessThan(toldOnceGrowth);
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

/** The `not allowed` failures `generate` finds in a Root, each with the line it prints and the declaration it names. */
function refusalsOf(root: Root, given: Partial<RootPackage> = {}) {
  const validated = validateRoot(root, aRootPackage(root, given));
  const failures = validated.kind === 'invalid' ? validated.failures : [];
  return failures
    .filter((failure) => failure.kind === 'not-allowed')
    .map((failure) => ({ line: failureLineOf(failure), declaration: failure.declaration }));
}

/** A Service whose Groups list the Endpoints given, one list for each Group, in order. */
function serviceOfGroups(...groups: readonly (readonly Endpoint[])[]): Root {
  return defineService({
    name: 'orders-service',
    groups: groups.map((endpoints, index) =>
      defineGroup({ name: `g${index}`, description: 'Group', endpoints } as never),
    ),
  });
}

describe('failure lines: Endpoints that share a site text', () => {
  const stamp = '(declared in @org/definitions@4.2.0#stamp)';

  test('two that hold a date at one field are one line, from the date met first, with its other site and its origin', () => {
    const exported = z.date();
    const earlier = anEndpoint('e0', 'GET /z', { a: exported });
    const first = anEndpoint('e', 'GET /x', { a: z.date() });
    const second = anEndpoint('e', 'GET /x', { a: exported });
    const installed = anInstalledPackage(defineDefinitions({}), { stamp: exported });

    const declared: readonly unknown[] = [earlier, first, second];

    const refusals = refusalsOf(serviceOfGroups([earlier], [first], [second]), {
      packages: [installed],
    });

    expect(refusals.map(({ line }) => line)).toEqual([
      `endpoints.GET /x (e) success.body.a ${date} (also in endpoints.GET /z (e0)) ${stamp}`,
    ]);
    expect(refusals.map(({ declaration }) => declared.indexOf(declaration))).toEqual([2]);
  });

  test('a def one holds directly and the other through a def, at one text, is told from the declaration that holds it directly', () => {
    const exported = z.date();
    const inner: z.ZodType = z
      .object({
        d: exported,
        get s() {
          return z.array(inner);
        },
      })
      .meta({ id: 'x' });
    const outer: z.ZodType = z
      .object({
        b: inner,
        m: z.date(),
        get s() {
          return z.array(outer);
        },
      })
      .meta({ id: 'm' });
    const throughDef = anEndpoint('e', 'GET /x', { a: outer });
    const direct = anEndpoint('e', 'GET /x', { a: z.object({ b: inner }) });
    const installed = anInstalledPackage(defineDefinitions({}), { stamp: exported });

    const declared: readonly unknown[] = [throughDef, direct];

    const refusals = refusalsOf(serviceOfGroups([throughDef], [direct]), { packages: [installed] });

    expect(refusals.map(({ line }) => line)).toEqual([
      `endpoints.GET /x (e) success.body.a.b.d ${date} ${stamp}`,
      `endpoints.GET /x (e) success.body.a.m ${date}`,
    ]);
    expect(refusals.map(({ declaration }) => declared.indexOf(declaration))).toEqual([1, 0]);
  });
});

const inheritedName =
  'not allowed: a field named constructor, which every object already has (zod reads it from Object.prototype when it is absent)';

const intersectionIsRefused =
  'not allowed: an intersection that is not of open objects reaching an openEnum() (use .extend())';

/**
 * A way a field holds a schema, as the lines write it: the steps it adds to the text of a place,
 * what it builds around the schema held, and the sentence it is refused with when that schema
 * reaches an openEnum().
 */
type Holder = {
  readonly steps: string;
  readonly build: (held: z.ZodType) => z.ZodType;
  readonly refusedAs?: string;
};

const holderNames = [
  'field',
  'option',
  'tupleItem',
  'tupleRest',
  'intersectionItem',
  'items',
  'value',
  'variant',
] as const;

type HolderName = (typeof holderNames)[number];

const holders: Readonly<Record<HolderName, Holder>> = {
  field: { steps: '', build: (held) => held },
  option: {
    steps: '<|0>',
    build: (held) => z.union([held, z.boolean()]),
    refusedAs: unionIsRefused,
  },
  tupleItem: { steps: '[1]', build: (held) => z.tuple([z.string(), held]) },
  tupleRest: { steps: '[...]', build: (held) => z.tuple([z.string()]).rest(held) },
  intersectionItem: {
    steps: '[0]',
    build: (held) => z.intersection(held, z.object({ k: z.string() })),
    refusedAs: intersectionIsRefused,
  },
  items: { steps: '[]', build: (held) => z.array(held) },
  value: { steps: '{}', build: (held) => z.record(z.string(), held) },
  variant: {
    steps: '<k="x">.v',
    build: (held) =>
      z.discriminatedUnion('k', [
        z.object({ k: z.literal('x'), v: held }),
        z.object({ k: z.literal('y'), w: z.string() }),
      ]),
  },
};

describe('failure lines: a chain of defs, each holding the one before twice', () => {
  /** `count` defs, each holding the one before as `next` and again as `f` through `holder`, the first holding `leaf`. */
  function twiceHeldChain(count: number, leaf: z.ZodType, holder: Holder): z.ZodType {
    let before: z.ZodType = z.object({ leaf });
    for (let index = 0; index < count; index++) {
      const held = before;
      const link: z.ZodType = z
        .object({
          next: held,
          f: holder.build(held),
          get self() {
            return link.optional();
          },
        })
        .meta({ id: `link${index}` });
      before = link;
    }
    return before;
  }

  const count = 16000;
  const twiceHolders = [
    ['a field', 'field'],
    ['a union option', 'option'],
    ['an intersection item', 'intersectionItem'],
    ['a tuple item', 'tupleItem'],
  ] as const;

  test.for(twiceHolders)(
    'a date below 16,000 defs, each holding the one before as next and through %s, is one line at the first place, in time that grows as the defs do',
    { timeout: growthTimeout },
    ([, name]) => {
      const holder = holders[name];
      const told = (size: number) => {
        const top = twiceHeldChain(size, z.date(), holder);
        const root = serviceWith([anEndpoint('alpha', 'GET /a', { top })]);
        return () => linesOf(root);
      };

      const growth = growthOf(told, { small: count / 8, large: count }, linearGrowth);
      const lines = told(count)();

      const firstPlace = `success.body.top${`.f${holder.steps}`.repeat(count)}.leaf`;
      expect(lines).toEqual([`endpoints.GET /a (alpha) ${firstPlace} ${date}`]);
      expect(growth).toBeLessThan(linearGrowth);
    },
  );

  test.for([
    ['a union option', 'option'],
    ['an intersection item', 'intersectionItem'],
  ] as const)(
    '16,000 defs, each holding the one before as next and through %s, are valid in time that grows as the defs do',
    { timeout: growthTimeout },
    ([, name]) => {
      const told = (size: number) => {
        const top = twiceHeldChain(size, z.string(), holders[name]);
        const root = serviceWith([anEndpoint('alpha', 'GET /a', { top })]);
        return () => linesOf(root);
      };

      const growth = growthOf(told, { small: count / 8, large: count }, linearGrowth);
      const lines = told(count)();

      expect(lines).toEqual([]);
      expect(growth).toBeLessThan(linearGrowth);
    },
  );
});

describe('failure lines: a shared schema held by many fields below a chain of defs', () => {
  /** `size` defs, each holding the one before as `next`, below which a def holds one date in `size` fields. */
  function widelyHeldRoot(size: number): Root {
    const date = z.date();
    const fields: Record<string, z.ZodType> = {};
    for (let index = 0; index < size; index++) {
      fields[`f${String(index).padStart(6, '0')}`] = date;
    }
    const bottom: z.ZodType = z
      .object({
        ...fields,
        get self() {
          return bottom.optional();
        },
      })
      .meta({ id: 'bottom' });
    let before = bottom;
    for (let index = 0; index < size; index++) {
      const held = before;
      const link: z.ZodType = z
        .object({
          next: held,
          get self() {
            return link.optional();
          },
        })
        .meta({ id: `link${index}` });
      before = link;
    }
    return serviceWith([anEndpoint('alpha', 'GET /a', { top: before })]);
  }

  test('a date held by 4,000 fields of a def below 4,000 defs is one line at the first field, in time that grows as both do', {
    timeout: growthTimeout,
  }, () => {
    const wide = 4000;
    const told = (size: number) => {
      const root = widelyHeldRoot(size);
      return () => linesOf(root);
    };

    const growth = growthOf(told, { small: wide / 8, large: wide }, linearGrowth);
    const lines = told(wide)();

    const firstField = `success.body.top${'.next'.repeat(wide)}.f000000`;
    expect(lines).toEqual([`endpoints.GET /a (alpha) ${firstField} ${date}`]);
    expect(growth).toBeLessThan(linearGrowth);
  });
});

/** Field names with the text a line writes them as: names that are prefixes of one another, quoted ones, and code points on both sides of U+FFFF. */
const fieldNames = [
  ['a', 'a'],
  ['a-b', 'a-b'],
  ['ab', 'ab'],
  ['a_', 'a_'],
  ['A', 'A'],
  ['a.b', '"a.b"'],
  ['\u{1F600}', '"\u{1F600}"'],
  ['￿', '"￿"'],
  ['constructor', 'constructor'],
] as const;

type FieldName = (typeof fieldNames)[number];

/** What a def or a body may hold at a field of its own beside defs: a date of its own, the shared date, and a union reaching an openEnum(). */
type Leaf = 'at' | 'sh' | 'op';

/** How often a def or a body holds each leaf: unions that are an openEnum() are drawn more often than the dates that make a def fail. */
const leafChances: Readonly<Record<Leaf, number>> = { at: 0.2, sh: 0.15, op: 0.45 };

const leaves = Object.keys(leafChances) as readonly Leaf[];

type Holding = {
  readonly name: FieldName;
  readonly holder: HolderName;
  readonly to: number;
};

/** What one def or body holds. */
type Holds = { readonly holdings: readonly Holding[]; readonly leaves: readonly Leaf[] };

/** The body of an Endpoint, whose site is that of the Endpoint of index `site`, an earlier one when two share a site text. */
type Body = Holds & { readonly site: number };

/** A graph of defs, each on a cycle of its own, held by the bodies of Endpoints. */
type Draw = {
  readonly defs: readonly Holds[];
  readonly bodies: readonly Body[];
  readonly exported: boolean;
};

/** What one def or body holds: `least` to 3 defs of `defCount`, sometimes one twice, and some leaves. */
function holdsOf(next: Next, defCount: number, least: number): Holds {
  const named = shuffled(fieldNames, next).slice(0, least + Math.floor(next() * (4 - least)));
  const targets = named.map(() => Math.floor(next() * defCount));
  if (targets.length > 1 && next() < 0.3) {
    targets[targets.length - 1] = targets[0] as number;
  }
  return {
    holdings: named.map((name, index) => ({
      name,
      holder: pickOf(next, holderNames),
      to: targets[index] as number,
    })),
    leaves: leaves.filter((leaf) => next() < leafChances[leaf]),
  };
}

function drawOf(seed: number): Draw {
  const next = seededNext(seed * 7919);
  const defCount = 2 + Math.floor(next() * 8);
  const bodyCount = 1 + Math.floor(next() * 3);
  const bodies = Array.from({ length: bodyCount }, (_, index) => ({
    ...holdsOf(next, defCount, 1),
    site: index > 0 && next() < 0.4 ? Math.floor(next() * index) : index,
  }));
  const defs = Array.from({ length: defCount }, () => holdsOf(next, defCount, 0));
  return { defs: withoutOpenBeyondFailures(defs), bodies, exported: next() < 0.5 };
}

/** The defs a def holds, itself, and those they hold, at any depth. */
function reachableFrom(defs: readonly Holds[], start: number): ReadonlySet<number> {
  const seen = new Set<number>();
  const pending = [start];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    if (!seen.has(next)) {
      seen.add(next);
      for (const { to } of defs[next]?.holdings ?? []) {
        pending.push(to);
      }
    }
  }
  return seen;
}

/** Whether a def fails on its own: it holds a date, the shared date or a field named constructor. */
function failsOnItsOwn({ leaves: held, holdings }: Holds): boolean {
  return (
    held.includes('at') ||
    held.includes('sh') ||
    holdings.some(({ name }) => name[0] === 'constructor')
  );
}

/**
 * The defs with the `op` leaf stripped from every def that a failing def reaches, itself included.
 * A union or an intersection over a schema that also fails is not refused, though the
 * README says it is at any depth, so a draw holds none, and the oracle below refuses one over
 * every def that reaches an openEnum().
 */
function withoutOpenBeyondFailures(defs: readonly Holds[]): readonly Holds[] {
  const beyondFailures = new Set<number>();
  defs.forEach((_, start) => {
    const reached = reachableFrom(defs, start);
    if ([...reached].some((index) => failsOnItsOwn(defs[index] as Holds))) {
      for (const index of reached) {
        beyondFailures.add(index);
      }
    }
  });
  return defs.map((holds, index) =>
    beyondFailures.has(index)
      ? { ...holds, leaves: holds.leaves.filter((leaf) => leaf !== 'op') }
      : holds,
  );
}

function lazily<Made>(make: () => Made): () => Made {
  let made: Made | undefined;
  return () => {
    made ??= make();
    return made;
  };
}

function leafOf(leaf: Leaf, shared: z.ZodType): z.ZodType {
  switch (leaf) {
    case 'at':
      return z.date();
    case 'sh':
      return shared;
    case 'op':
      return z.union([openEnum(['a', 'b']), z.number()]);
  }
}

/** The fields of a def or a body: its leaves, and each holding as a getter, since defs hold each other. */
function shapeOf(holds: Holds, defs: readonly z.ZodType[], shared: z.ZodType) {
  const shape: Record<string, z.ZodType> = {};
  for (const leaf of holds.leaves) {
    shape[leaf] = leafOf(leaf, shared);
  }
  for (const { name, holder, to } of holds.holdings) {
    const held = lazily(() => holders[holder].build(defs[to] as z.ZodType));
    Object.defineProperty(shape, name[0], { enumerable: true, get: held });
  }
  return shape;
}

/** The Root of a draw, and the Definitions Package that exports the shared date when it does. */
function rootOfDraw(draw: Draw) {
  const shared = z.date();
  const defs: z.ZodType[] = [];
  draw.defs.forEach((holds, index) => {
    const shape = shapeOf(holds, defs, shared);
    Object.defineProperty(shape, 'self', {
      enumerable: true,
      get: () => z.array(defs[index] as z.ZodType),
    });
    defs.push(z.object(shape).meta({ id: `d${index}` }));
  });
  const endpoints = draw.bodies.map((body) =>
    anEndpoint(`e${body.site}`, `GET /e${body.site}`, shapeOf(body, defs, shared)),
  );
  const root = serviceOfGroups(...endpoints.map((endpoint) => [endpoint]));
  const packages = draw.exported
    ? [anInstalledPackage(defineDefinitions({}), { stamp: shared })]
    : [];
  return { root, given: { packages } };
}

/** A place a refusal is told at, with its site. */
type At = { readonly text: string; readonly site: string };

/** The text of a site of a body. */
function siteOf({ site }: Body): string {
  return `endpoints.GET /e${site} (e${site})`;
}

/** The order of two texts by code point, a shorter text first when it begins the other, read from the code points themselves. */
function byPoints(left: string, right: string): number {
  const leftPoints = Array.from(left, (point) => point.codePointAt(0) ?? 0);
  const rightPoints = Array.from(right, (point) => point.codePointAt(0) ?? 0);
  const common = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < common; index++) {
    const difference = (leftPoints[index] as number) - (rightPoints[index] as number);
    if (difference !== 0) {
      return difference;
    }
  }
  return leftPoints.length - rightPoints.length;
}

/** The text a def held at a field is at, below the place `from` it is held at. */
function belowOf(from: At, { name, holder }: Holding): At {
  return { text: `${from.text}.${name[1]}${holders[holder].steps}`, site: from.site };
}

/**
 * The first place of each def, in code point order, relaxing every hold as many rounds as there are
 * defs: the smallest of its places in a body and of the places it is held at, counted from the
 * first place of each def that holds it.
 */
function firstPlacesOf(draw: Draw): readonly (At | undefined)[] {
  const inBodies = draw.defs.map(() => [] as At[]);
  for (const body of draw.bodies) {
    const from = { text: `${siteOf(body)} success.body`, site: siteOf(body) };
    for (const holding of body.holdings) {
      inBodies[holding.to]?.push(belowOf(from, holding));
    }
  }
  let first: readonly (At | undefined)[] = draw.defs.map(() => undefined);
  for (let round = 0; round <= draw.defs.length; round++) {
    const held = inBodies.map((places) => [...places]);
    draw.defs.forEach((holds, owner) => {
      const from = first[owner];
      if (from === undefined) {
        return;
      }
      for (const holding of holds.holdings) {
        held[holding.to]?.push(belowOf(from, holding));
      }
    });
    first = held.map((places) => places.sort((left, right) => byPoints(left.text, right.text))[0]);
  }
  return first;
}

/** The sites of the bodies that reach each def, through the defs they hold. */
function sitesReachingOf(draw: Draw): readonly ReadonlySet<string>[] {
  const reaching = draw.defs.map(() => new Set<string>());
  for (const body of draw.bodies) {
    for (const { to } of body.holdings) {
      for (const index of reachableFrom(draw.defs, to)) {
        reaching[index]?.add(siteOf(body));
      }
    }
  }
  return reaching;
}

/** Whether each def reaches a union that is an openEnum(), itself or through the defs it holds, so a union or an intersection that holds it is refused. */
function reachesOpenOf({ defs }: Draw): readonly boolean[] {
  return defs.map((_, start) =>
    [...reachableFrom(defs, start)].some((index) => defs[index]?.leaves.includes('op')),
  );
}

/** A refusal at a place: what is refused, the schema refused, and every site that reaches the place. */
type Telling = {
  readonly schema: string;
  readonly refusal: string;
  readonly at: At;
  readonly sites: ReadonlySet<string>;
};

/** A def or a body that holds refusals: its name, its place and the sites that reach it. */
type Owner = {
  readonly id: string;
  readonly at: At;
  readonly sites: ReadonlySet<string>;
};

/** The refusals a def or a body holds at its place: its leaves, and the unions and intersections that hold a def reaching an openEnum(). */
function tellingsOf(
  owner: Owner,
  holds: Holds,
  reachesOpen: readonly boolean[],
): readonly Telling[] {
  const { id, at: from, sites } = owner;
  const told = holds.leaves.map((leaf) => ({
    schema: leaf === 'sh' ? 'shared' : `${id}.${leaf}`,
    refusal: leaf === 'op' ? unionIsRefused : date,
    at: { text: `${from.text}.${leaf}`, site: from.site },
    sites,
  }));
  for (const { name, holder, to } of holds.holdings) {
    const refusal = holders[holder].refusedAs;
    const at = { text: `${from.text}.${name[1]}`, site: from.site };
    if (refusal !== undefined && reachesOpen[to]) {
      told.push({ schema: `${id}.${name[0]}`, refusal, at, sites });
    }
    if (name[0] === 'constructor') {
      told.push({ schema: `${id}.${name[0]}`, refusal: inheritedName, at, sites });
    }
  }
  return told;
}

/** Every refusal of a draw at each place it is held at, in a body or in a def reached from one, a def's from its first place. */
function allTellingsOf(draw: Draw): readonly Telling[] {
  const first = firstPlacesOf(draw);
  const reaching = sitesReachingOf(draw);
  const reachesOpen = reachesOpenOf(draw);
  const inBodies = draw.bodies.flatMap((body, index) => {
    const at = { text: `${siteOf(body)} success.body`, site: siteOf(body) };
    return tellingsOf({ id: `b${index}`, at, sites: new Set([at.site]) }, body, reachesOpen);
  });
  const inDefs = draw.defs.flatMap((holds, index) => {
    const at = first[index];
    const sites = reaching[index] ?? new Set<string>();
    return at === undefined ? [] : tellingsOf({ id: `d${index}`, at, sites }, holds, reachesOpen);
  });
  return [...inBodies, ...inDefs];
}

/** The tellings of one schema as one, at the smallest of their places, with the sites of them all. */
function foldedBySchema(tellings: readonly Telling[]): readonly Telling[] {
  const bySchema = new Map<string, Telling[]>();
  for (const telling of tellings) {
    const key = `${telling.schema} ${telling.refusal}`;
    bySchema.set(key, [...(bySchema.get(key) ?? []), telling]);
  }
  return [...bySchema.values()].map((group) => {
    const [first] = [...group].sort((left, right) => byPoints(left.at.text, right.at.text));
    return { ...(first as Telling), sites: new Set(group.flatMap(({ sites }) => [...sites])) };
  });
}

/** The line of the refusals at one place: the sites that also reach it in code point order, and the origin of the shared date when it is exported. */
function lineOf(group: readonly Telling[], exported: boolean): string {
  const [{ at, refusal, schema }] = group as readonly [Telling];
  const sites = new Set(group.flatMap((telling) => [...telling.sites]));
  const others = [...sites].filter((site) => site !== at.site).sort(byPoints);
  const alsoIn = others.length === 0 ? '' : ` (also in ${others.join(', ')})`;
  const origin =
    exported && schema === 'shared' ? ' (declared in @org/definitions@4.2.0#stamp)' : '';
  return `${at.text} ${refusal}${alsoIn}${origin}`;
}

/**
 * The lines a draw prints, worked out from its own graph: each refusal inside a def at the first
 * place of the def followed by its own steps, a schema several places hold at the first of them,
 * with every other site. The lines are compared sorted, since their order is the order the walk
 * meets them in, which this does not model.
 */
function toldLinesOf(draw: Draw): readonly string[] {
  const byPlace = new Map<string, Telling[]>();
  for (const telling of foldedBySchema(allTellingsOf(draw))) {
    const key = `${telling.at.text} ${telling.refusal}`;
    byPlace.set(key, [...(byPlace.get(key) ?? []), telling]);
  }
  return [...byPlace.values()].map((group) => lineOf(group, draw.exported));
}

const graphSeeds = Array.from({ length: 400 }, (_, index) => index + 1);

/** Whether two Endpoints of a draw have one site text. */
function sharesSiteText({ bodies }: Draw): boolean {
  return bodies.some(({ site }, index) => site !== index);
}

/** A line without the origin of the schema, which two refusals at one site text and one place may name differently. */
function withoutOrigin(line: string): string {
  return line.replace(/ \(declared in [^)]*\)$/, '');
}

describe('failure lines: a graph of defs, drawn at random', () => {
  test.for(graphSeeds)(
    'draw %i: each refusal is told from the first place in code point order, with every other site',
    (seed) => {
      const draw = drawOf(seed);
      const { root, given } = rootOfDraw(draw);

      const lines = linesOf(root, given).filter((line) => line.includes(' not allowed: '));

      const read = (line: string) => (sharesSiteText(draw) ? withoutOrigin(line) : line);
      expect(lines.map(read).sort()).toEqual(toldLinesOf(draw).map(read).sort());
    },
  );

  test('the draws hold every kind of step and of name, told in the lines, and shared site texts, origins and refused compositions', () => {
    const draws = graphSeeds.map(drawOf);
    const holdings = draws.flatMap(({ defs, bodies }) =>
      [...defs, ...bodies].flatMap(({ holdings: held }) => held),
    );
    const lines = draws.flatMap(toldLinesOf);
    const unmet = (parts: readonly string[]) =>
      parts.filter((part) => !lines.some((line) => line.includes(part)));

    expect({
      holders: holderNames.filter((name) => !holdings.some(({ holder }) => holder === name)),
      names: fieldNames.filter(([name]) => !holdings.some((held) => held.name[0] === name)),
      steps: unmet(holderNames.map((name) => holders[name].steps).filter((steps) => steps !== '')),
      written: unmet(fieldNames.map(([, written]) => `.${written}`)),
      words: unmet([' (also in ', ' (declared in ', unionIsRefused, intersectionIsRefused]),
      sharedSiteTexts: draws.some(sharesSiteText),
    }).toEqual({
      holders: [],
      names: [],
      steps: [],
      written: [],
      words: [],
      sharedSiteTexts: true,
    });
  });
});
