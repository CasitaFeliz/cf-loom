import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import type * as core from 'zod/v4/core';
import { summarized } from '../../test/failures.ts';
import { aRootPackage } from '../../test/root-package.ts';
import {
  type Attachment,
  defineEndpoint,
  defineGroup,
  defineGuard,
  defineService,
  type Endpoint,
  type Guard,
} from '../index.ts';
import { type Root, validateRoot } from '../internal/index.ts';

/** Validates a Root as the package it names: its package.json named as the Root is. */
function validateInPackage(root: Root) {
  return summarized(validateRoot(root, aRootPackage(root)));
}

/** What a Guard may demand, so a cast can put a part there the types refuse. */
type Demands = { readonly headers: core.$ZodObject };

const listing = {
  name: 'listOrders',
  method: 'GET',
  path: '/orders',
  visibility: 'public',
  description: 'Every order',
  success: { status: 200, body: z.array(z.object({ id: z.uuid() })) },
} as const;

const userToken = defineGuard({
  name: 'userToken',
  description: 'A signed-in user',
  demands: { headers: z.object({ authorization: z.string() }) },
  context: z.object({ userId: z.string() }),
});

const permission = defineGuard({
  name: 'permission',
  description: 'The user holds every listed permission',
  guards: [userToken],
  qualifier: z.array(z.enum(['orders:read', 'orders:edit'])).min(1),
});

const quota = defineGuard({
  name: 'quota',
  description: 'The Caller stays within a quota',
  qualifier: z.object({ perMinute: z.int(), burst: z.object({ size: z.int() }).optional() }),
});

/** The result of validating one Endpoint with these Attachments, cast where the types refuse them. */
function validateGuards(guards: readonly Attachment[]) {
  const endpoint = defineEndpoint({ ...listing, guards });
  return validateEndpoint(endpoint);
}

function validateEndpoint(endpoint: Endpoint) {
  const orders = defineGroup({ name: 'orders', description: 'Orders', endpoints: [endpoint] });
  return validateInPackage(defineService({ name: 'orders-service', groups: [orders] }));
}

function failed(location: string, rule: string, message: string) {
  return { kind: 'invalid', failures: [{ kind: 'declaration', location, rule, message }] };
}

const guardsAt = 'endpoints.GET /orders (listOrders) guards';

describe('validateRoot: what a Guard demands', () => {
  test('a Guard demanding headers and query validates', () => {
    const paged = defineGuard({
      name: 'paged',
      description: 'A page',
      demands: { headers: z.object({ 'x-page': z.int() }), query: z.object({ page: z.int() }) },
    });

    expect(validateGuards([paged]).kind).toBe('valid');
  });

  test('a Guard demanding the body fails', () => {
    const demands = { body: z.object({ signature: z.string() }) } as unknown as Demands;
    const signed = defineGuard({ name: 'signed', description: 'A signed body', demands });

    expect(validateGuards([signed])).toEqual(
      failed(
        'guards.signed demands.body',
        'guard-demands',
        'A Guard demands only headers and query',
      ),
    );
  });

  test('a Guard demanding path params fails', () => {
    const demands = { params: z.object({ tenantId: z.string() }) } as unknown as Demands;
    const tenant = defineGuard({ name: 'tenant', description: 'A tenant in the path', demands });

    expect(validateGuards([tenant])).toEqual(
      failed(
        'guards.tenant demands.params',
        'guard-demands',
        'A Guard demands only headers and query',
      ),
    );
  });
});

describe('validateRoot: the order of an Endpoint’s Guards', () => {
  test('a dependent Guard after the Guards it lists validates', () => {
    expect(
      validateGuards([userToken, { guard: permission, qualifier: ['orders:edit'] }]).kind,
    ).toBe('valid');
  });

  test('a dependent Guard before a Guard it lists fails', () => {
    const guards: readonly Attachment[] = [
      { guard: permission, qualifier: ['orders:edit'] },
      userToken,
    ];

    expect(validateGuards(guards)).toEqual(
      failed(`${guardsAt}[0]`, 'guard-order', 'permission requires userToken earlier in guards'),
    );
  });

  test('a Guard only a Guard’s guards reaches is judged with the rest: its demands fail beside guard-order', () => {
    const demands = { body: z.object({ signature: z.string() }) } as unknown as Demands;
    const g1 = defineGuard({ name: 'g1', description: 'A signed body', demands });
    const g0 = defineGuard({ name: 'g0', description: 'Builds on g1', guards: [g1] });
    const guards: readonly Attachment[] = [g0];

    const validated = validateGuards(guards);

    expect(validated).toEqual({
      kind: 'invalid',
      failures: expect.arrayContaining([
        {
          kind: 'declaration',
          location: `${guardsAt}[0]`,
          rule: 'guard-order',
          message: 'g0 requires g1 earlier in guards',
        },
        {
          kind: 'declaration',
          location: 'guards.g1 demands.body',
          rule: 'guard-demands',
          message: 'A Guard demands only headers and query',
        },
      ]),
    });
  });

  test('a Guard listed twice fails', () => {
    const guards: readonly Attachment[] = [userToken, userToken];

    expect(validateGuards(guards)).toEqual(
      failed(`${guardsAt}[1]`, 'guard-once', 'userToken is listed twice'),
    );
  });

  test('a Guard listed twice is checked once for its dependencies', () => {
    const guards: readonly Attachment[] = [
      userToken,
      { guard: permission, qualifier: ['orders:edit'] },
      { guard: permission, qualifier: ['orders:read'] },
    ];

    expect(validateGuards(guards)).toEqual(
      failed(`${guardsAt}[2]`, 'guard-once', 'permission is listed twice'),
    );
  });
});

describe('validateRoot: bare and qualified Attachments', () => {
  test('a Guard with a qualifier listed bare fails', () => {
    const guards: readonly Attachment[] = [userToken, permission];

    expect(validateGuards(guards)).toEqual(
      failed(
        `${guardsAt}[1]`,
        'attachment-needs-qualifier',
        'permission needs a qualifier: { guard, qualifier }',
      ),
    );
  });

  test('a qualified Attachment of a Guard without a qualifier fails', () => {
    const guards: readonly Attachment[] = [{ guard: userToken, qualifier: 'anything' }];

    expect(validateGuards(guards)).toEqual(
      failed(`${guardsAt}[0]`, 'attachment-takes-no-qualifier', 'userToken takes no qualifier'),
    );
  });

  test('an Attachment that names no Guard fails', () => {
    const guards = ['userToken'] as unknown as readonly Attachment[];

    expect(validateGuards(guards)).toEqual(
      failed(
        `${guardsAt}[0]`,
        'not-an-attachment',
        'An Attachment is a Guard or { guard, qualifier }',
      ),
    );
  });
});

describe('validateRoot: Attachments written without a Guard or a Qualifier', () => {
  test('a qualified Attachment whose guard is null fails once, as a required field', () => {
    const guards = [{ guard: null, qualifier: 'acme' }] as unknown as readonly Attachment[];

    expect(validateGuards(guards)).toEqual(
      failed(`${guardsAt}[0].guard`, 'required-field', 'guard is a required field'),
    );
  });

  test('a qualified Attachment without a guard fails once, as a required field', () => {
    const guards = [{ qualifier: 'acme' }] as unknown as readonly Attachment[];

    expect(validateGuards(guards)).toEqual(
      failed(`${guardsAt}[0].guard`, 'required-field', 'guard is a required field'),
    );
  });

  test('a qualified Attachment whose guard is no Guard still fails as no Attachment', () => {
    const guards = [{ guard: 'tenant', qualifier: 'acme' }] as unknown as readonly Attachment[];

    expect(validateGuards(guards)).toEqual(
      failed(
        `${guardsAt}[0]`,
        'not-an-attachment',
        'An Attachment is a Guard or { guard, qualifier }',
      ),
    );
  });

  test('a Qualifier written null fails once, as a required field', () => {
    const guards = [{ guard: quota, qualifier: null }] as unknown as readonly Attachment[];

    expect(validateGuards(guards)).toEqual(
      failed(`${guardsAt}[0].qualifier`, 'required-field', 'qualifier is a required field'),
    );
  });
});

describe('validateRoot: a Qualifier against its schema', () => {
  test('a Qualifier its schema accepts validates', () => {
    expect(validateGuards([{ guard: quota, qualifier: { perMinute: 60 } }]).kind).toBe('valid');
  });

  test('a Qualifier its schema refuses fails', () => {
    const guards: readonly Attachment[] = [{ guard: quota, qualifier: { perMinute: 'many' } }];

    expect(validateGuards(guards)).toEqual(
      failed(
        `${guardsAt}[0].qualifier`,
        'qualifier-value',
        'quota takes a Qualifier its schema accepts',
      ),
    );
  });

  test('an empty list where the schema asks for one item fails', () => {
    const guards: readonly Attachment[] = [userToken, { guard: permission, qualifier: [] }];

    expect(validateGuards(guards)).toEqual(
      failed(
        `${guardsAt}[1].qualifier`,
        'qualifier-value',
        'permission takes a Qualifier its schema accepts',
      ),
    );
  });

  test('an undeclared key in an object Qualifier fails', () => {
    const guards: readonly Attachment[] = [
      { guard: quota, qualifier: { perMinute: 60, extra: true } },
    ];

    expect(validateGuards(guards)).toEqual(
      failed(
        `${guardsAt}[0].qualifier`,
        'qualifier-keys',
        'A Qualifier holds only the keys its schema keeps when zod parses it: extra',
      ),
    );
  });

  test('two undeclared keys in an object Qualifier fail, listed closed by and', () => {
    const guards: readonly Attachment[] = [
      { guard: quota, qualifier: { perMinute: 60, extra: true, other: 1 } },
    ];

    expect(validateGuards(guards)).toEqual(
      failed(
        `${guardsAt}[0].qualifier`,
        'qualifier-keys',
        'A Qualifier holds only the keys its schema keeps when zod parses it: extra and other',
      ),
    );
  });

  test('an undeclared key in an object nested in a Qualifier fails', () => {
    const guards: readonly Attachment[] = [
      { guard: quota, qualifier: { perMinute: 60, burst: { size: 5, every: 'minute' } } },
    ];

    expect(validateGuards(guards)).toEqual(
      failed(
        `${guardsAt}[0].qualifier`,
        'qualifier-keys',
        'A Qualifier holds only the keys its schema keeps when zod parses it: burst.every',
      ),
    );
  });

  test('an undeclared key in an object listed in a Qualifier fails', () => {
    const roles = defineGuard({
      name: 'roles',
      description: 'The user holds one of the roles',
      qualifier: z.array(z.object({ role: z.string() })),
    });
    const guards: readonly Attachment[] = [
      { guard: roles, qualifier: [{ role: 'admin' }, { role: 'clerk', extra: true }] },
    ];

    expect(validateGuards(guards)).toEqual(
      failed(
        `${guardsAt}[0].qualifier`,
        'qualifier-keys',
        'A Qualifier holds only the keys its schema keeps when zod parses it: 1.extra',
      ),
    );
  });

  test('a Qualifier that is a variant of a discriminated union holds only that variant’s keys', () => {
    const scope = defineGuard({
      name: 'scope',
      description: 'What the token may reach',
      qualifier: z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('all') }),
        z.object({ kind: z.literal('tenant'), tenantId: z.string() }),
      ]),
    });
    const accepted = validateGuards([
      { guard: scope, qualifier: { kind: 'tenant', tenantId: 'acme' } },
    ]);
    const guards: readonly Attachment[] = [
      { guard: scope, qualifier: { kind: 'all', tenantId: 'acme' } },
    ];

    expect(accepted.kind).toBe('valid');
    expect(validateGuards(guards)).toEqual(
      failed(
        `${guardsAt}[0].qualifier`,
        'qualifier-keys',
        'A Qualifier holds only the keys its schema keeps when zod parses it: tenantId',
      ),
    );
  });

  test('a Qualifier the first option of a union refuses is judged by the option that parses it', () => {
    const scope = defineGuard({
      name: 'scope',
      description: 'What the token may reach',
      qualifier: z.union([
        z.object({ tenantId: z.string() }),
        z.object({ region: z.string(), zone: z.string().optional() }),
      ]),
    });
    const guards: readonly Attachment[] = [
      { guard: scope, qualifier: { region: 'eu', zone: 'west', extra: true } },
    ];

    expect(validateGuards(guards)).toEqual(
      failed(
        `${guardsAt}[0].qualifier`,
        'qualifier-keys',
        'A Qualifier holds only the keys its schema keeps when zod parses it: extra',
      ),
    );
  });

  test('a Qualifier of an intersection holds the keys any of its items declares', () => {
    const scope = defineGuard({
      name: 'scope',
      description: 'What the token may reach',
      qualifier: z.intersection(
        z.object({ tenantId: z.string() }).describe('The tenant'),
        z.object({ region: z.string() }).describe('The region'),
      ),
    });
    const accepted = validateGuards([
      { guard: scope, qualifier: { tenantId: 'acme', region: 'eu' } },
    ]);
    const guards: readonly Attachment[] = [
      { guard: scope, qualifier: { tenantId: 'acme', region: 'eu', extra: true } },
    ];

    expect(accepted.kind).toBe('valid');
    expect(validateGuards(guards)).toEqual(
      failed(
        `${guardsAt}[0].qualifier`,
        'qualifier-keys',
        'A Qualifier holds only the keys its schema keeps when zod parses it: extra',
      ),
    );
  });

  test('a Qualifier of a recursive schema is judged through its refs', () => {
    type Node = { name: string; children: Node[] };
    const node: z.ZodType<Node> = z
      .lazy(() => z.object({ name: z.string(), children: z.array(node) }))
      .meta({ id: 'node' });
    const tree = defineGuard({ name: 'tree', description: 'A tree of scopes', qualifier: node });
    const guards: readonly Attachment[] = [
      {
        guard: tree,
        qualifier: { name: 'root', children: [{ name: 'leaf', children: [], extra: 1 }] },
      },
    ];

    expect(validateGuards(guards)).toEqual(
      failed(
        `${guardsAt}[0].qualifier`,
        'qualifier-keys',
        'A Qualifier holds only the keys its schema keeps when zod parses it: children.0.extra',
      ),
    );
  });

  test('a Qualifier key the first matching option of a union drops fails, as zod strips it', () => {
    const grant = defineGuard({
      name: 'grant',
      description: 'What the token may do',
      qualifier: z.union([
        z.object({ role: z.string() }),
        z.object({ role: z.string(), scope: z.string() }),
      ]),
    });
    const guards: readonly Attachment[] = [
      { guard: grant, qualifier: { role: 'admin', scope: 'orders' } },
    ];

    expect(validateGuards(guards)).toEqual(
      failed(
        `${guardsAt}[0].qualifier`,
        'qualifier-keys',
        'A Qualifier holds only the keys its schema keeps when zod parses it: scope',
      ),
    );
  });

  test('the same Qualifier validates when the scoped option of the union comes first', () => {
    const grant = defineGuard({
      name: 'grant',
      description: 'What the token may do',
      qualifier: z.union([
        z.object({ role: z.string(), scope: z.string() }),
        z.object({ role: z.string() }),
      ]),
    });

    const validated = validateGuards([
      { guard: grant, qualifier: { role: 'admin', scope: 'orders' } },
    ]);

    expect(validated.kind).toBe('valid');
  });

  test('an undeclared key in a record value is named by its dotted path', () => {
    const levels = defineGuard({
      name: 'levels',
      description: 'A level per tenant',
      qualifier: z.record(z.string(), z.object({ level: z.int() })),
    });
    const guards: readonly Attachment[] = [
      { guard: levels, qualifier: { acme: { level: 1 }, globex: { level: 2, extra: true } } },
    ];

    expect(validateGuards(guards)).toEqual(
      failed(
        `${guardsAt}[0].qualifier`,
        'qualifier-keys',
        'A Qualifier holds only the keys its schema keeps when zod parses it: globex.extra',
      ),
    );
  });

  test('an undeclared key in a tuple item is named by its dotted path', () => {
    const pair = defineGuard({
      name: 'pair',
      description: 'A tenant and its limits',
      qualifier: z.tuple([z.string(), z.object({ perMinute: z.int() })]),
    });
    const guards: readonly Attachment[] = [
      { guard: pair, qualifier: ['acme', { perMinute: 60, extra: true }] },
    ];

    expect(validateGuards(guards)).toEqual(
      failed(
        `${guardsAt}[0].qualifier`,
        'qualifier-keys',
        'A Qualifier holds only the keys its schema keeps when zod parses it: 1.extra',
      ),
    );
  });

  test('an undeclared key named after an Object.prototype member is reported', () => {
    const guards: readonly Attachment[] = [
      { guard: quota, qualifier: { perMinute: 60, constructor: true } },
    ];

    expect(validateGuards(guards)).toEqual(
      failed(
        `${guardsAt}[0].qualifier`,
        'qualifier-keys',
        'A Qualifier holds only the keys its schema keeps when zod parses it: constructor',
      ),
    );
  });

  test('a Qualifier is not judged while its schema holds a construct that is not allowed', () => {
    const refined = defineGuard({
      name: 'refined',
      description: 'A refined qualifier',
      qualifier: z.string().refine((value) => value !== '') as core.$ZodType,
    });
    const guards: readonly Attachment[] = [{ guard: refined, qualifier: 7 }];

    expect(validateGuards(guards)).toEqual({
      kind: 'invalid',
      failures: [
        {
          kind: 'not-allowed',
          location: 'guards.refined qualifier',
          construct: '.refine(), z.custom() or z.instanceof()',
          alsoIn: [],
          origin: undefined,
        },
      ],
    });
  });
});

describe('validateRoot: Guards typed wider than their declarations', () => {
  test('a Guard typed as any Guard is checked by what it declares', () => {
    const guard: Guard = permission;
    const guards: readonly Attachment[] = [userToken, guard];

    expect(validateGuards(guards)).toEqual(
      failed(
        `${guardsAt}[1]`,
        'attachment-needs-qualifier',
        'permission needs a qualifier: { guard, qualifier }',
      ),
    );
  });
});

/** A seeded generator of the same sequence every run, so a failing draw can be replayed. */
function seededNext(seed: number): () => number {
  let state = seed;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

/** A Qualifier schema and a source of values it accepts, with keys the schema may not declare. */
type Sample = { readonly schema: z.ZodType; readonly nextValue: () => unknown };

type ObjectSample = Sample & { readonly schema: z.ZodObject };

const text: Sample = { schema: z.string(), nextValue: () => 'text' };
const count: Sample = { schema: z.int(), nextValue: () => 7 };

function oneOf<Item>(next: () => number, items: readonly [Item, ...Item[]]): Item {
  return items[Math.floor(next() * items.length)] ?? items[0];
}

/** An object whose keys come from one small pool, so the options of a union share and shadow keys. */
function anObject(next: () => number, depth: number, tag?: string): ObjectSample {
  const pool = { a: text, b: count, c: aSample(next, depth - 1), d: text };
  const declared = Object.entries(pool).filter(() => next() < 0.5);
  const optional = new Set(declared.filter(() => next() < 0.3).map(([key]) => key));
  const declaredKeys = new Set(declared.map(([key]) => key));
  const undeclared = Object.keys(pool).filter((key) => !declaredKeys.has(key));
  const shape = Object.fromEntries(
    declared.map(([key, field]) => [
      key,
      optional.has(key) ? z.optional(field.schema) : field.schema,
    ]),
  );
  const present = declared.filter(([key]) => !optional.has(key) || next() < 0.5);
  const extras = undeclared.filter(() => next() < 0.5);
  return {
    schema: z.object(tag === undefined ? shape : { kind: z.literal(tag), ...shape }),
    nextValue: () => ({
      ...(tag === undefined ? {} : { kind: tag }),
      ...Object.fromEntries(present.map(([key, field]) => [key, field.nextValue()])),
      ...Object.fromEntries(extras.map((key) => [key, next() < 0.5 ? 1 : { a: 1 }])),
    }),
  };
}

function aUnion(next: () => number, depth: number): Sample {
  const third = next() < 0.5 ? [anObject(next, depth)] : [];
  const options: readonly [ObjectSample, ...ObjectSample[]] = [
    anObject(next, depth),
    anObject(next, depth),
    ...third,
  ];
  return {
    schema: z.union(options.map((option) => option.schema)),
    nextValue: () => oneOf(next, options).nextValue(),
  };
}

function aTaggedUnion(next: () => number, depth: number): Sample {
  const options = [
    anObject(next, depth, 'k0'),
    anObject(next, depth, 'k1'),
    anObject(next, depth, 'k2'),
  ] as const;
  return {
    schema: z.discriminatedUnion('kind', [options[0].schema, options[1].schema, options[2].schema]),
    nextValue: () => oneOf(next, options).nextValue(),
  };
}

function aRecord(next: () => number, depth: number): Sample {
  const member = aSample(next, depth - 1);
  return {
    schema: z.record(z.string(), member.schema),
    nextValue: () => ({
      x: member.nextValue(),
      ...(next() < 0.5 ? { y: member.nextValue() } : {}),
    }),
  };
}

function anArray(next: () => number, depth: number): Sample {
  const item = aSample(next, depth - 1);
  return {
    schema: z.array(item.schema),
    nextValue: () => Array.from({ length: Math.floor(next() * 3) }, () => item.nextValue()),
  };
}

function aTuple(next: () => number, depth: number): Sample {
  const first = aSample(next, depth - 1);
  const second = aSample(next, depth - 1);
  return {
    schema: z.tuple([first.schema, second.schema]),
    nextValue: () => [first.nextValue(), second.nextValue()],
  };
}

function aSample(next: () => number, depth: number): Sample {
  if (depth === 0) {
    return oneOf(next, [text, count]);
  }
  const build = oneOf(next, [
    anObject,
    anObject,
    aUnion,
    aUnion,
    aTaggedUnion,
    aRecord,
    anArray,
    aTuple,
  ]);
  return build(next, depth);
}

/** Every key and index of a value, as paths. */
function pathsOf(value: unknown, at: readonly string[] = []): readonly (readonly string[])[] {
  if (typeof value !== 'object' || value === null) {
    return [];
  }
  return Object.entries(value).flatMap(([key, member]) => [
    [...at, key],
    ...pathsOf(member, [...at, key]),
  ]);
}

/** The outermost paths of `value` that `parsed` lacks: what zod's parse stripped. */
function strippedPathsOf(value: unknown, parsed: unknown): readonly string[] {
  const kept = new Set(pathsOf(parsed).map((path) => path.join('.')));
  return pathsOf(value)
    .filter((path) => !kept.has(path.join('.')))
    .filter((path) => path.length === 1 || kept.has(path.slice(0, -1).join('.')))
    .map((path) => path.join('.'))
    .sort();
}

type Validated = ReturnType<typeof validateGuards>;

type Reported = Extract<Validated, { readonly kind: 'invalid' }>['failures'][number];

type KeysReported = Extract<Reported, { readonly kind: 'declaration' }>;

function isQualifierKeysFailure(reported: Reported): reported is KeysReported {
  return reported.kind === 'declaration' && reported.rule === 'qualifier-keys';
}

function keysNamedBy(reported: KeysReported): readonly string[] {
  return reported.message.slice(reported.message.indexOf(': ') + 2).split(', ');
}

/** The paths a validated Root names in its `qualifier-keys` failures. */
function reportedKeysOf(validated: Validated): readonly string[] {
  if (validated.kind === 'valid') {
    return [];
  }
  return validated.failures.filter(isQualifierKeysFailure).flatMap(keysNamedBy).sort();
}

describe('validateRoot: a Qualifier holds the keys zod keeps when it parses it', () => {
  test('generate names exactly the keys zod strips, whatever the union, record, array or tuple around them', () => {
    const next = seededNext(214);
    let stripping = 0;
    for (let draw = 0; draw < 300; draw += 1) {
      const { schema, nextValue } = aSample(next, 2);
      const qualifier = nextValue();
      const guard = defineGuard({ name: 'scope', description: 'A scope', qualifier: schema });
      const stripped = strippedPathsOf(qualifier, z.parse(schema, qualifier));
      stripping += stripped.length === 0 ? 0 : 1;

      const validated = validateGuards([{ guard, qualifier } as Attachment]);

      expect(reportedKeysOf(validated), `draw ${draw}`).toEqual(stripped);
      expect(validated.kind, `draw ${draw}`).toBe(stripped.length === 0 ? 'valid' : 'invalid');
    }
    expect(stripping).toBeGreaterThan(30);
  });
});

/** `count` Guards, each listing the one before it, the first listing none, in that order. */
function aChainOf(count: number): readonly Guard[] {
  const chain: Guard[] = [];
  for (let index = 0; index < count; index++) {
    const listed = chain.at(-1);
    const guards = listed === undefined ? [] : [listed];
    chain.push(defineGuard({ name: `g${index}`, description: 'A link', guards }));
  }
  return chain;
}

describe('validateRoot: Guards that list Guards, at any depth', () => {
  test('a chain of 20,000 Guards attached in order validates', () => {
    const chain = aChainOf(20_000);

    expect(validateGuards(chain).kind).toBe('valid');
  });

  test('an Endpoint attaching only the last of 20,000 Guards in a chain fails guard-order', () => {
    const chain = aChainOf(20_000);

    expect(validateGuards(chain.slice(-1))).toEqual(
      failed(`${guardsAt}[0]`, 'guard-order', 'g19999 requires g19998 earlier in guards'),
    );
  });
});

describe('validateRoot: a deep Qualifier', () => {
  /** A Qualifier schema of objects, each holding the next under `next`, as deep as a value goes. */
  const linked: z.ZodType = z
    .object({ next: z.lazy(() => linked).optional() })
    .meta({ id: 'linked' });
  const chained = defineGuard({ name: 'chained', description: 'A chain', qualifier: linked });

  test('a Qualifier 100,000 objects deep that zod cannot parse within the call stack fails qualifier-value', () => {
    let qualifier: object = {};
    for (let level = 0; level < 100_000; level++) {
      qualifier = { next: qualifier };
    }

    expect(validateGuards([{ guard: chained, qualifier }])).toEqual(
      failed(
        `${guardsAt}[0].qualifier`,
        'qualifier-value',
        'chained takes a Qualifier its schema accepts',
      ),
    );
  });

  test('a Qualifier that holds itself is read to its end and validates', () => {
    const qualifier: { next?: object } = {};
    qualifier.next = { next: qualifier };

    expect(validateGuards([{ guard: chained, qualifier }]).kind).toBe('valid');
  });

  test('a key zod strips 200 objects deep, under the 256 levels a Snapshot holds, fails naming its dotted path', () => {
    let qualifier: object = { extra: true };
    for (let level = 0; level < 200; level++) {
      qualifier = { next: qualifier };
    }

    expect(validateGuards([{ guard: chained, qualifier }])).toEqual(
      failed(
        `${guardsAt}[0].qualifier`,
        'qualifier-keys',
        `A Qualifier holds only the keys its schema keeps when zod parses it: ${'next.'.repeat(200)}extra`,
      ),
    );
  });
});
