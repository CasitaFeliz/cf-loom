import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import type * as core from 'zod/v4/core';
import { summarized } from '../../test/failures.ts';
import { growthOf } from '../../test/growth.ts';
import { aRootPackage } from '../../test/root-package.ts';
import { defineEndpoint, defineEvent, defineGroup, defineService, openEnum } from '../index.ts';
import { type SchemaNode, validateRoot } from '../internal/index.ts';

/** The Service whose one Endpoint answers the body given. */
function aServiceAnswering(body: core.$ZodType) {
  const echo = defineEndpoint({
    name: 'echo',
    method: 'GET',
    path: '/echo',
    visibility: 'public',
    description: 'Echo',
    success: { status: 200, body },
  });
  const group = defineGroup({ name: 'shapes', description: 'Shapes', endpoints: [echo] });
  return defineService({ name: 'shapes-service', groups: [group] });
}

/** Validates a Contract whose one Endpoint answers the body given. */
function validatedWithBody(body: core.$ZodType) {
  const root = aServiceAnswering(body);
  return summarized(validateRoot(root, aRootPackage(root)));
}

/** Validates a Contract whose one Endpoint takes the body given as its Input. */
function validatedWithInputBody(body: core.$ZodType) {
  const echo = defineEndpoint({
    name: 'echo',
    method: 'POST',
    path: '/echo',
    visibility: 'public',
    description: 'Echo',
    input: { body },
    success: { status: 204 },
  });
  const group = defineGroup({ name: 'shapes', description: 'Shapes', endpoints: [echo] });
  const root = defineService({ name: 'shapes-service', groups: [group] });
  return summarized(validateRoot(root, aRootPackage(root)));
}

/** Validates a Contract whose one Event carries the body given. */
function validatedWithMessageBody(body: core.$ZodType) {
  const shaped = defineEvent({
    name: 'Shaped',
    version: 1,
    visibility: 'internal',
    description: 'Shaped',
    body,
  });
  const group = defineGroup({ name: 'shapes', description: 'Shapes', events: [shaped] });
  const root = defineService({ name: 'shapes-service', groups: [group] });
  return summarized(validateRoot(root, aRootPackage(root)));
}

const refusal = {
  kind: 'not-allowed',
  construct: 'an intersection that is not of open objects reaching an openEnum()',
  instead: '.extend()',
  alsoIn: [],
};

const bodyAt = 'endpoints.GET /echo (echo) success.body';

describe('validateRoot: an intersection reaching an Open Enum', () => {
  test('an intersection of an object and a discriminated union is allowed', () => {
    const payment = z.discriminatedUnion('type', [z.object({ type: z.literal('card') })]);
    const body = z.intersection(z.object({ type: z.string() }), payment);

    const validated = validatedWithBody(body);

    expect(validated.kind).toBe('valid');
  });

  test('an intersection with an Open Enum deep inside is not allowed where it is written', () => {
    const status = z.object({ inner: z.object({ status: openEnum(['a']) }) });
    const body = z.object({
      both: z.intersection(status, z.record(z.string(), z.json())),
    });

    const validated = validatedWithBody(body);

    expect(validated).toEqual({
      kind: 'invalid',
      failures: [{ ...refusal, location: `${bodyAt}.both` }],
    });
  });

  test('an intersection reaching an Open Enum through a recursive def is not allowed', () => {
    const tree = z
      .object({
        status: openEnum(['a']),
        get children() {
          return z.array(tree);
        },
      })
      .meta({ id: 'tree' });
    const body = z.intersection(z.object({ root: tree }), z.record(z.string(), z.json()));

    const validated = validatedWithBody(body);

    expect(validated).toEqual({ kind: 'invalid', failures: [{ ...refusal, location: bodyAt }] });
  });

  test('an intersection inside a recursive def is not allowed once, at the first place that reaches it', () => {
    const tree = z
      .object({
        both: z.intersection(z.object({ status: openEnum(['a']) }), z.record(z.string(), z.json())),
        get children() {
          return z.array(tree);
        },
      })
      .meta({ id: 'tree' });
    const body = z.object({ first: tree, second: tree });

    const validated = validatedWithBody(body);

    expect(validated).toEqual({
      kind: 'invalid',
      failures: [{ ...refusal, location: `${bodyAt}.first.both` }],
    });
  });

  test.each([
    [
      'an intersection',
      (inner: core.$ZodType) =>
        z.intersection(inner, z.union([z.object({ c: z.string() }), z.object({ d: z.string() })])),
      [
        ['union', '[0][0]'],
        ['intersection', '[0]'],
        ['intersection', ''],
      ],
    ],
    [
      'a union in an intersection',
      (inner: core.$ZodType) =>
        z.intersection(z.union([inner, z.object({ e: z.string() })]), z.object({ f: z.string() })),
      [
        ['union', '[0]<|0>[0]'],
        ['intersection', '[0]<|0>'],
        ['union', '[0]'],
        ['intersection', ''],
      ],
    ],
  ])(
    'an intersection reaching an Open Enum inside %s is reported at every depth that reaches it',
    (_outer, outerOf, inside) => {
      const options = z.union([z.object({ s: openEnum(['a']) }), z.object({ t: z.string() })]);
      const inner = z.intersection(options, z.object({ b: z.string() }));

      const validated = validatedWithBody(outerOf(inner));

      expect(validated).toEqual({
        kind: 'invalid',
        failures: inside.map(([kind, at]) => ({
          ...(kind === 'union' ? unionRefusal : refusal),
          location: `${bodyAt}${at}`,
        })),
      });
    },
  );

  test('two separate intersections reaching an Open Enum are each reported', () => {
    const open = () =>
      z.intersection(
        z.union([z.object({ s: openEnum(['a']) }), z.object({ q: z.string() })]),
        z.object({ b: z.string() }),
      );

    const validated = validatedWithBody(z.object({ a: open(), b: open() }));

    expect(validated).toEqual({
      kind: 'invalid',
      failures: [
        { ...unionRefusal, location: `${bodyAt}.a[0]` },
        { ...refusal, location: `${bodyAt}.a` },
        { ...unionRefusal, location: `${bodyAt}.b[0]` },
        { ...refusal, location: `${bodyAt}.b` },
      ],
    });
  });

  test('two intersections reaching an Open Enum at different depths are each reported', () => {
    const open = () =>
      z.intersection(
        z.union([z.object({ s: openEnum(['a']) }), z.object({ q: z.string() })]),
        z.object({ b: z.string() }),
      );

    const validated = validatedWithBody(z.object({ a: open(), b: z.object({ c: open() }) }));

    expect(validated).toEqual({
      kind: 'invalid',
      failures: [
        { ...unionRefusal, location: `${bodyAt}.a[0]` },
        { ...refusal, location: `${bodyAt}.a` },
        { ...unionRefusal, location: `${bodyAt}.b.c[0]` },
        { ...refusal, location: `${bodyAt}.b.c` },
      ],
    });
  });

  test('an intersection in a def is judged where it is used even when the schema using it fails the walk', () => {
    const tree = z
      .object({
        x: z.intersection(
          z.union([z.object({ s: openEnum(['a']) }), z.object({ q: z.string() })]),
          z.object({ b: z.string() }),
        ),
        get c() {
          return z.array(tree);
        },
      })
      .meta({ id: 'tree' });

    const validated = validatedWithBody(z.object({ bad: z.any(), t: tree }));

    expect(validated.kind === 'invalid' ? validated.failures : []).toEqual(
      expect.arrayContaining([
        { ...refusal, location: `${bodyAt}.t.x` },
        { ...unionRefusal, location: `${bodyAt}.t.x[0]` },
        expect.objectContaining({ location: `${bodyAt}.bad` }),
      ]),
    );
  });

  test('an intersection with no Open Enum is allowed', () => {
    const body = z.intersection(
      z.object({ status: z.enum(['a']) }),
      z.record(z.string(), z.string()),
    );

    const validated = validatedWithBody(body);

    expect(validated.kind).toBe('valid');
  });

  test('an Open Enum in a merged intersection of open objects is allowed', () => {
    const body = z.intersection(z.object({ status: openEnum(['a']) }), z.object({ b: z.string() }));

    const validated = validatedWithBody(body);

    expect(validated.kind).toBe('valid');
  });
});

const unionRefusal = {
  kind: 'not-allowed',
  construct: 'a z.union() reaching an openEnum()',
  instead: 'z.discriminatedUnion(), or one openEnum() of all the values',
  alsoIn: [],
};

const inputBodyAt = 'endpoints.POST /echo (echo) input.body';

describe('validateRoot: a plain union reaching an Open Enum', () => {
  test('an Open Enum option of a union is not allowed, at the union', () => {
    const body = z.union([openEnum(['a']), z.literal('b')]);

    const validated = validatedWithBody(body);

    expect(validated).toEqual({
      kind: 'invalid',
      failures: [{ ...unionRefusal, location: bodyAt }],
    });
  });

  test.each([
    [
      'an object option',
      z.union([z.object({ t: openEnum(['a']) }), z.object({ t: z.literal('b') })]),
      [''],
    ],
    ['an array option', z.union([z.array(openEnum(['a'])), z.string()]), ['']],
    [
      'a discriminated union option',
      z.union([
        z.discriminatedUnion('type', [
          z.object({ type: z.literal('card'), brand: openEnum(['visa']) }),
          z.object({ type: z.literal('transfer') }),
        ]),
        z.string(),
      ]),
      [''],
    ],
    ['a union option', z.union([z.union([openEnum(['a']), z.number()]), z.string()]), ['<|0>', '']],
  ])('an Open Enum inside %s is reported at every union that reaches it', (_place, body, at) => {
    const validated = validatedWithBody(body);

    expect(validated).toEqual({
      kind: 'invalid',
      failures: at.map((steps) => ({ ...unionRefusal, location: `${bodyAt}${steps}` })),
    });
  });

  test('a union reaching an Open Enum through a recursive def is not allowed, at the union', () => {
    const tree = z
      .object({
        status: openEnum(['a']),
        get children() {
          return z.array(tree);
        },
      })
      .meta({ id: 'tree' });
    const body = z.union([tree, z.string()]);

    const validated = validatedWithBody(body);

    expect(validated).toEqual({
      kind: 'invalid',
      failures: [{ ...unionRefusal, location: bodyAt }],
    });
  });

  test('a union inside a recursive def is not allowed once, at the first place that reaches it', () => {
    const tree = z
      .object({
        either: z.union([z.object({ status: openEnum(['a']) }), z.string()]),
        get children() {
          return z.array(tree);
        },
      })
      .meta({ id: 'tree' });
    const body = z.object({ first: tree, second: tree });

    const validated = validatedWithBody(body);

    expect(validated).toEqual({
      kind: 'invalid',
      failures: [{ ...unionRefusal, location: `${bodyAt}.first.either` }],
    });
  });

  test('a union inside an intersection is reported with the intersection', () => {
    const either = z.union([z.object({ s: openEnum(['a']) }), z.object({ t: z.string() })]);
    const body = z.intersection(either, z.object({ b: z.string() }));

    const validated = validatedWithBody(body);

    expect(validated).toEqual({
      kind: 'invalid',
      failures: [
        { ...unionRefusal, location: `${bodyAt}[0]` },
        { ...refusal, location: bodyAt },
      ],
    });
  });

  test('an intersection inside a union is reported with the union', () => {
    const both = z.intersection(z.object({ s: openEnum(['a']) }), z.record(z.string(), z.json()));
    const body = z.union([both, z.object({ e: z.string() })]);

    const validated = validatedWithBody(body);

    expect(validated).toEqual({
      kind: 'invalid',
      failures: [
        { ...refusal, location: `${bodyAt}<|0>` },
        { ...unionRefusal, location: bodyAt },
      ],
    });
  });

  test('two separate unions reaching an Open Enum are each reported', () => {
    const open = () => z.union([z.object({ s: openEnum(['a']) }), z.string()]);

    const validated = validatedWithBody(z.object({ a: open(), b: open() }));

    expect(validated).toEqual({
      kind: 'invalid',
      failures: [
        { ...unionRefusal, location: `${bodyAt}.a` },
        { ...unionRefusal, location: `${bodyAt}.b` },
      ],
    });
  });

  test('a union reaching an Open Enum in an Input body is not allowed', () => {
    const body = z.union([z.object({ t: openEnum(['a']) }), z.object({ t: z.literal('b') })]);

    const validated = validatedWithInputBody(body);

    expect(validated).toEqual({
      kind: 'invalid',
      failures: [{ ...unionRefusal, location: inputBodyAt }],
    });
  });

  test('a union reaching an Open Enum in a Message body is not allowed', () => {
    const choice = z.union([z.object({ t: openEnum(['a']) }), z.object({ t: z.literal('b') })]);

    const validated = validatedWithMessageBody(z.object({ choice }));

    expect(validated).toEqual({
      kind: 'invalid',
      failures: [
        {
          ...unionRefusal,
          location: 'events.Shaped@1 body.choice',
        },
      ],
    });
  });

  test('a discriminated union whose variants hold an Open Enum is allowed', () => {
    const body = z.discriminatedUnion('type', [
      z.object({ type: z.literal('card'), brand: openEnum(['visa']) }),
      z.object({ type: z.literal('transfer') }),
    ]);

    const validated = validatedWithBody(body);

    expect(validated.kind).toBe('valid');
  });

  test('a union of closed values is allowed', () => {
    const body = z.union([
      z.object({ t: z.enum(['a', 'b']) }),
      z.object({ t: z.literal('c') }),
      z.string(),
    ]);

    const validated = validatedWithBody(body);

    expect(validated.kind).toBe('valid');
  });
});

/** What holds an Open Enum inside it, and the compositions inside it that the Open Enum makes refused. */
type Holder = {
  readonly label: string;
  readonly holding: (open: core.$ZodType) => core.$ZodType;
  /** The kind and the steps, from the holder, of each composition it holds that reaches the Open Enum. */
  readonly inside: readonly (readonly ['union' | 'intersection', string])[];
};

/**
 * How each kind of node holds an Open Enum inside it; a kind that holds none lists no holder, and
 * a `ref` reaches one through a def, as the ways below do.
 */
const holders = {
  string: [],
  number: [],
  boolean: [],
  json: [],
  ref: [],
  enum: [{ label: 'an Open Enum', holding: (open) => open, inside: [] }],
  object: [{ label: 'an object field', holding: (open) => z.object({ status: open }), inside: [] }],
  record: [{ label: 'a record value', holding: (open) => z.record(z.string(), open), inside: [] }],
  array: [{ label: 'an array item', holding: (open) => z.array(open), inside: [] }],
  tuple: [
    { label: 'a tuple item', holding: (open) => z.tuple([open, z.string()]), inside: [] },
    { label: 'a tuple rest', holding: (open) => z.tuple([z.string()], open), inside: [] },
  ],
  tagged: [
    {
      label: 'a tagged variant',
      holding: (open) =>
        z.discriminatedUnion('type', [
          z.object({ type: z.literal('card'), status: open }),
          z.object({ type: z.literal('transfer') }),
        ]),
      inside: [],
    },
  ],
  union: [
    {
      label: 'a union option',
      holding: (open) => z.union([open, z.string()]),
      inside: [['union', '']],
    },
  ],
  allOf: [
    {
      label: 'an intersection item',
      holding: (open) => z.intersection(z.object({ status: open }), z.record(z.string(), z.json())),
      inside: [['intersection', '']],
    },
  ],
} as const satisfies Record<SchemaNode['type'], readonly Holder[]>;

const holdersOfEveryKind: readonly Holder[] = Object.values(holders).flat();

/** Where a composition names what holds the Open Enum, and the steps from the composition's operand down to it. */
type Way = {
  readonly label: string;
  readonly reaching: (held: core.$ZodType) => {
    readonly operand: core.$ZodType;
    readonly steps: string;
  };
};

const ways: readonly Way[] = [
  { label: 'written inline', reaching: (held) => ({ operand: held, steps: '' }) },
  {
    label: 'a def',
    reaching: (held) => {
      const named: z.ZodType = z
        .object({
          held,
          get self() {
            return named.optional();
          },
        })
        .meta({ id: 'toString' });
      return { operand: named, steps: '.held' };
    },
  },
  {
    label: 'a chain of two defs',
    reaching: (held) => {
      const inner: z.ZodType = z
        .object({
          held,
          get self() {
            return inner.optional();
          },
        })
        .meta({ id: 'inner' });
      const outer: z.ZodType = z
        .object({
          next: inner,
          get self() {
            return outer.optional();
          },
        })
        .meta({ id: 'outer' });
      return { operand: outer, steps: '.next.held' };
    },
  },
  {
    label: 'a cycle of two defs',
    reaching: (held) => {
      const first: z.ZodType = z
        .object({
          get second() {
            return second.optional();
          },
        })
        .meta({ id: 'first' });
      const second: z.ZodType = z
        .object({
          held,
          get first() {
            return first.optional();
          },
        })
        .meta({ id: 'second' });
      return { operand: first, steps: '.second.held' };
    },
  },
  {
    label: 'an alias def',
    reaching: (held) => {
      const target: z.ZodType = z
        .object({
          held,
          get back() {
            return alias.optional();
          },
        })
        .meta({ id: 'target' });
      const alias: z.ZodType = z.lazy(() => target).meta({ id: 'alias' });
      return { operand: alias, steps: '.held' };
    },
  },
];

/** A composition around an operand, with where it puts the operand and what it refuses. */
type Around = {
  readonly label: string;
  readonly composed: (operand: core.$ZodType) => core.$ZodType;
  readonly operandAt: string;
  readonly refusal: typeof refusal;
};

const arounds: readonly Around[] = [
  {
    label: 'a union',
    composed: (operand) => z.union([operand, z.string()]),
    operandAt: '<|0>',
    refusal: unionRefusal,
  },
  {
    label: 'an intersection',
    composed: (operand) => z.intersection(operand, z.string()),
    operandAt: '[0]',
    refusal,
  },
];

describe('validateRoot: a composition reaching an Open Enum through every kind of node', () => {
  const cases = arounds.flatMap((around) =>
    ways.flatMap((way) => holdersOfEveryKind.map((holder) => ({ around, way, holder }))),
  );

  test.each(cases)(
    '$around.label reaching an Open Enum through $holder.label, $way.label, is not allowed, at the composition',
    ({ around, way, holder }) => {
      const { operand, steps } = way.reaching(holder.holding(openEnum(['a'])));

      const validated = validatedWithBody(around.composed(operand));

      const insides = holder.inside.map(([kind, at]) => ({
        ...(kind === 'union' ? unionRefusal : refusal),
        location: `${bodyAt}${around.operandAt}${steps}${at}`,
      }));
      expect(validated).toEqual({
        kind: 'invalid',
        failures: [...insides, { ...around.refusal, location: bodyAt }],
      });
    },
  );

  test.each(cases)(
    '$around.label whose operand is $holder.label holding what reaches an Open Enum through $way.label is not allowed, at the composition',
    ({ around, way, holder }) => {
      const { operand } = way.reaching(openEnum(['a']));

      const validated = validatedWithBody(around.composed(holder.holding(operand)));

      const insides = holder.inside.map(([kind, at]) => ({
        ...(kind === 'union' ? unionRefusal : refusal),
        location: `${bodyAt}${around.operandAt}${at}`,
      }));
      expect(validated).toEqual({
        kind: 'invalid',
        failures: [...insides, { ...around.refusal, location: bodyAt }],
      });
    },
  );

  test('a union or an intersection beside an Open Enum it does not reach is allowed', () => {
    const closed: z.ZodType = z
      .object({
        status: z.enum(['a', 'b']),
        get self() {
          return closed.optional();
        },
      })
      .meta({ id: 'closed' });
    const open: z.ZodType = z
      .object({
        status: openEnum(['a']),
        get self() {
          return open.optional();
        },
      })
      .meta({ id: 'open' });
    const body = z.object({
      open,
      either: z.union([closed, z.string()]),
      both: z.intersection(closed, z.string()),
    });

    const validated = validatedWithBody(body);

    expect(validated.kind).toBe('valid');
  });

  test('a union naming a def called toString that holds no Open Enum is allowed', () => {
    const named: z.ZodType = z
      .object({
        status: z.enum(['a']),
        get self() {
          return named.optional();
        },
      })
      .meta({ id: 'toString' });

    const validated = validatedWithBody(z.union([named, z.string()]));

    expect(validated.kind).toBe('valid');
  });
});

describe('validateRoot, a long chain of ids', () => {
  const sizes = { small: 2_000, large: 16_000 };

  /**
   * How many times longer a Root with a chain eight times as long may take: about 8 for a rule
   * that reads each id once, and 64 for one that reads every id a composition reaches at each
   * composition.
   */
  const linearGrowth = 13;

  /** A growth test builds and times its shape up to nine times over, which a CI runner that several runs share stretches several times over. */
  const growthTimeout = 240_000;

  /** `count` ids, each on a cycle of its own, holding the one before it in what `holdingOf` makes of it. */
  function aChainOf(count: number, holdingOf: (previous: z.ZodType) => z.ZodType): z.ZodType {
    let head: z.ZodType = z.string();
    for (let index = 0; index < count; index++) {
      const previous = head;
      const link: z.ZodType = z
        .object({
          held: holdingOf(previous),
          get self() {
            return link.optional();
          },
        })
        .meta({ id: `link${index}` });
      head = link;
    }
    return head;
  }

  /** The validation of a Service whose Endpoint answers `body`, built outside the time. */
  function validationOf(body: z.ZodType) {
    const root = aServiceAnswering(body);
    const rootPackage = aRootPackage(root);
    return () => validateRoot(root, rootPackage);
  }

  test('a chain of ids, each holding the one before it in a union option, is validated in time that grows with its length', {
    timeout: growthTimeout,
  }, () => {
    const validateChain = (count: number) => {
      const top = aChainOf(count, (previous) => z.union([previous, z.boolean()]));
      return validationOf(z.object({ top }));
    };

    const validated = validateChain(sizes.large)();
    const growth = growthOf(validateChain, sizes, linearGrowth);

    expect(validated.kind).toBe('valid');
    expect(growth).toBeLessThan(linearGrowth);
  });

  test('a chain of ids, each holding the one before it in an intersection with a string, is validated in time that grows with its length', {
    timeout: growthTimeout,
  }, () => {
    const validateChain = (count: number) => {
      const top = aChainOf(count, (previous) => z.intersection(previous, z.string()));
      return validationOf(z.object({ top }));
    };

    const validated = validateChain(sizes.large)();
    const growth = growthOf(validateChain, sizes, linearGrowth);

    expect(validated.kind).toBe('valid');
    expect(growth).toBeLessThan(linearGrowth);
  });

  test('many unions, each naming the head of one long chain of ids, are validated in time that grows with their number and the chain’s length', {
    timeout: growthTimeout,
  }, () => {
    const validateFan = (count: number) => {
      const head = aChainOf(count, (previous) => previous);
      const fields = Array.from({ length: count }, (_, index) => [
        `field${index}`,
        z.union([head, z.boolean()]),
      ]);
      return validationOf(z.object(Object.fromEntries(fields)));
    };

    const validated = validateFan(sizes.large)();
    const growth = growthOf(validateFan, sizes, linearGrowth);

    expect(validated.kind).toBe('valid');
    expect(growth).toBeLessThan(linearGrowth);
  });
});
