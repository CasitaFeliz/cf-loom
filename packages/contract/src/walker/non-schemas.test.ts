import { describe, expect, expectTypeOf, test } from 'vitest';
import { z } from 'zod';
import { z as z3 } from 'zod/v3';
import type * as core from 'zod/v4/core';
import { refusalsOf } from '../../test/failures.ts';
import { authorPathOf, type Def, type Step, walkSchemas } from '../internal/index.ts';

const notZod4 = 'a value that is no zod 4 schema (zod/v3 is not read)';

function exportAt(name: string) {
  return { site: { kind: 'export', name }, declaration: undefined, steps: undefined } as const;
}

function walkBody(schema: unknown) {
  return walkSchemas([{ at: exportAt('body'), schema: schema as core.$ZodType }], () => undefined);
}

function fieldAt(name: string): Step {
  return { kind: 'field', name };
}

function optionAt(index: number): Step {
  return { kind: 'option', index };
}

const keyAt: Step = { kind: 'key' };
const valueAt: Step = { kind: 'value' };
const itemsAt: Step = { kind: 'items' };

/** A slot a schema holds another in: how to build it around a child, and where the child sits. */
type Slot = {
  readonly name: string;
  readonly around: (child: never) => unknown;
  readonly steps: readonly Step[];
  /** The slot walks what lies inside its child only when it is the child itself that is bad. */
  readonly onlyDirect?: true;
  /** A value zod itself takes as "nothing here", so there is nothing to refuse. */
  readonly noneIs?: unknown;
  /** What the slot itself refuses beside any child, its own lines. */
  readonly alsoRefused?: readonly string[];
  /** What the slot refuses beside a child that is a schema but not one it takes. */
  readonly alsoRefusedAroundSchema?: readonly string[];
  /** A slot reads through the child that is this one to what it holds, so judges it by that. */
  readonly isReadThrough?: true;
  /** The slot is a record's key: it tells what its child, when that builds a part, makes of a key. */
  readonly isRecordKey?: true;
  /** What a record key says of this slot's schema, which builds a part even where a value inside it is refused. */
  readonly asRecordKey?: string;
};

const keyNotString = 'a z.record() key that is not a string';

const jsonOptions = [z.string(), z.number(), z.boolean(), z.null()] as const;
const stringKeyed = z.record(z.string(), z.string());

/** Every slot the walk reads a schema in, those the readers peek at before they enter included. */
const slots: readonly Slot[] = [
  {
    name: 'an object field',
    around: (child) => z.object({ a: child }),
    steps: [fieldAt('a')],
    asRecordKey: keyNotString,
  },
  {
    name: 'a field’s .optional()',
    around: (child) => z.object({ a: z.optional(child) }),
    steps: [fieldAt('a')],
    asRecordKey: keyNotString,
  },
  {
    name: 'a field’s .nonoptional()',
    around: (child) => z.object({ a: z.nonoptional(child) }),
    steps: [fieldAt('a')],
    asRecordKey: keyNotString,
  },
  {
    name: 'a .nullable()',
    around: (child) => z.nullable(child),
    steps: [],
    asRecordKey: 'a nullable z.record() key',
  },
  {
    name: 'an array’s items',
    around: (child) => z.array(child),
    steps: [itemsAt],
    asRecordKey: keyNotString,
  },
  {
    name: 'a tuple’s item',
    around: (child) => z.tuple([child]),
    steps: [{ kind: 'index', index: 0 }],
    asRecordKey: keyNotString,
  },
  {
    name: 'a tuple’s rest',
    around: (child) => new z.ZodTuple({ type: 'tuple', items: [z.string()], rest: child }),
    steps: [{ kind: 'rest' }],
    noneIs: null,
    asRecordKey: keyNotString,
  },
  {
    name: 'a record’s value',
    around: (child) => new z.ZodRecord({ type: 'record', keyType: z.string(), valueType: child }),
    steps: [valueAt],
    asRecordKey: keyNotString,
  },
  {
    name: 'a record’s key',
    around: (child) => z.record(child, z.string()),
    steps: [keyAt],
    isRecordKey: true,
  },
  {
    name: 'a union’s option',
    around: (child) => z.union([z.string(), child]),
    steps: [optionAt(1)],
    asRecordKey: keyNotString,
  },
  {
    name: 'an intersection’s side',
    around: (child) => z.intersection(child, z.object({})),
    steps: [{ kind: 'index', index: 0 }],
  },
  {
    name: 'a lazy’s result',
    around: (child) => z.lazy(() => child),
    steps: [],
    isReadThrough: true,
  },
  {
    name: 'a pipe’s in',
    around: (child) => new z.ZodPipe({ type: 'pipe', in: child, out: z.string() }),
    steps: [],
    alsoRefused: ['.pipe()'],
  },
  {
    name: 'a pipe’s out',
    around: (child) => new z.ZodPipe({ type: 'pipe', in: z.string(), out: child }),
    steps: [],
    alsoRefused: ['.pipe()'],
  },
  {
    name: 'a .readonly()',
    around: (child) => z.readonly(child),
    steps: [],
    alsoRefused: ['.readonly()'],
  },
  {
    name: 'a set’s value',
    around: (child) => z.set(child),
    steps: [],
    alsoRefused: ['z.set()'],
  },
  {
    name: 'a map’s value',
    around: (child) => z.map(z.string(), child),
    steps: [valueAt],
    alsoRefused: ['z.map()'],
  },
  {
    name: 'a catchall',
    around: (child) => z.object({}).catchall(child),
    steps: [],
    onlyDirect: true,
    noneIs: undefined,
  },
  {
    name: 'a field of a discriminated union’s variant',
    around: (child) => z.discriminatedUnion('k', [z.object({ k: z.literal('a'), x: child })]),
    steps: [{ kind: 'variant', discriminator: 'k', value: '"a"' }, fieldAt('x')],
    asRecordKey: keyNotString,
  },
  {
    name: 'a field of a lazy discriminated union variant',
    around: (child) =>
      z.discriminatedUnion('k', [z.lazy(() => z.object({ k: z.literal('a'), x: child })) as never]),
    steps: [{ kind: 'variant', discriminator: 'k', value: '"a"' }, fieldAt('x')],
    asRecordKey: keyNotString,
  },
  {
    name: 'a discriminated union’s discriminator',
    around: (child) => z.discriminatedUnion('k', [z.object({ k: child })]),
    steps: [optionAt(0), fieldAt('k')],
    alsoRefusedAroundSchema: ['a discriminated union variant whose discriminator is not a literal'],
    asRecordKey: keyNotString,
  },
  {
    name: 'a discriminated union’s variant',
    around: (child) => z.discriminatedUnion('k', [child]),
    steps: [optionAt(0)],
    onlyDirect: true,
    asRecordKey: keyNotString,
  },
  {
    name: 'a discriminated union’s lazy variant',
    around: (child) => z.discriminatedUnion('k', [z.lazy(() => child) as never]),
    steps: [optionAt(0)],
    onlyDirect: true,
    asRecordKey: keyNotString,
  },
  {
    name: 'a JSON-shaped union’s record key',
    around: (child) => z.union([...jsonOptions, z.array(z.string()), z.record(child, z.string())]),
    steps: [optionAt(5), keyAt],
    alsoRefused: ['z.null()'],
    asRecordKey: keyNotString,
    isRecordKey: true,
  },
  {
    name: 'a JSON-shaped union’s array items',
    around: (child) => z.union([...jsonOptions, z.array(child), stringKeyed]),
    steps: [optionAt(4), itemsAt],
    alsoRefused: ['z.null()'],
    asRecordKey: keyNotString,
  },
  {
    name: 'a JSON-shaped union’s option',
    around: (child) => z.union([...jsonOptions, child, stringKeyed]),
    steps: [optionAt(4)],
    alsoRefused: ['z.null()'],
    asRecordKey: keyNotString,
  },
];

const badValues = [
  { what: 'a zod/v3 schema', value: () => z3.string() },
  { what: 'a zod/v3 object', value: () => z3.object({ a: z3.string() }) },
  { what: '{}', value: () => ({}) },
  { what: 'null', value: () => null },
  { what: 'undefined', value: () => undefined },
  { what: '5', value: () => 5 },
  { what: 'a hand-built _zod', value: () => ({ _zod: { def: { type: 'string' } } }) },
];

type Nesting = readonly [inner: Slot] | readonly [outer: Slot, inner: Slot];

/** The inner slot alone, and inside each slot that walks what lies inside its child. */
function nestingsOf(inner: Slot): readonly Nesting[] {
  const outers = slots.filter((outer) => outer.onlyDirect !== true);
  return [[inner], ...outers.map((outer): Nesting => [outer, inner])];
}

/** The schema of a bad value in these slots, or none when zod refuses to build it. */
function builtAs(nesting: Nesting, bad: unknown): unknown {
  let schema = bad;
  try {
    for (const { around } of nesting.toReversed()) {
      schema = around(schema as never);
    }
  } catch {
    return undefined;
  }
  return schema;
}

function isNothingHere(slot: Slot, bad: unknown): boolean {
  return Object.hasOwn(slot, 'noneIs') && slot.noneIs === bad;
}

/**
 * What is wrong with the walk of a bad value at the end of these slots, none when all is well: one
 * line says it is no zod 4 schema, at its place, and the only others are the slots' own.
 */
function problemOf(nesting: Nesting, what: string, schema: unknown): string | undefined {
  const label = `${nesting.map(({ name }) => name).join(' > ')} :: ${what}`;
  const at = authorPathOf(nesting.flatMap(({ steps }) => steps)) ?? '';
  const own = nesting.flatMap(linesOf);
  try {
    const failures = failuresOf(schema);
    const constructs = failures.map(({ construct }) => construct).toSorted();
    const refusedAtItsPlace = failures.some(
      (failure) => failure.at === at && failure.construct === notZod4,
    );
    const expected = [notZod4, ...own].toSorted();
    const isAsExpected = refusedAtItsPlace && sameList(constructs, expected);
    return isAsExpected
      ? undefined
      : `${label}: ${JSON.stringify(failures)}, not ${at}: ${expected}`;
  } catch (error) {
    return `${label}: threw ${String(error)}`;
  }
}

/**
 * The lines a slot earns of its own: those beside any child, those beside a schema, and what a
 * record key says of a child that builds a part, since a key is a string alone.
 */
function linesOf(slot: Slot, position: number, nesting: readonly Slot[]): readonly string[] {
  const child = nesting[position + 1];
  const aroundSchema = child !== undefined && child.isReadThrough !== true;
  const asKey = slot.isRecordKey === true && child?.asRecordKey !== undefined;
  return [
    ...(slot.alsoRefused ?? []),
    ...(aroundSchema ? (slot.alsoRefusedAroundSchema ?? []) : []),
    ...(asKey ? [child.asRecordKey] : []),
  ];
}

function sameList(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

/** The walk of every bad value in a nesting of slots: its problem if it has one, else none. */
function walksOf(nesting: Nesting): readonly (string | undefined)[] {
  const inner = nesting.at(-1) as Slot;
  const built = badValues
    .map(({ what, value }) => ({ what, bad: value() }))
    .filter(({ bad }) => !isNothingHere(inner, bad))
    .map(({ what, bad }) => ({ what, schema: builtAs(nesting, bad) }))
    .filter(({ schema }) => schema !== undefined);
  return built.map(({ what, schema }) => problemOf(nesting, what, schema));
}

function isProblem(problem: string | undefined): problem is string {
  return problem !== undefined;
}

/** The refusals of a walk of one schema, as `at` and `construct`, with what to use instead. */
function failuresOf(schema: unknown) {
  const [entry] = refusalsOf(walkBody(schema)).located;
  return entry !== undefined && 'failures' in entry ? entry.failures : [];
}

describe('walkSchemas: a value that is no zod 4 schema in any slot', () => {
  test.each(slots)(
    '$name holds one: a located refusal, alone and inside any other slot, never a throw',
    (inner) => {
      const walks = nestingsOf(inner).flatMap(walksOf);

      expect(walks.filter(isProblem)).toEqual([]);
      expect(walks.length).toBeGreaterThan(0);
    },
  );
});

/** The refusals of a walk in the order of their places, so a test can state them in any order. */
function sortedFailuresOf(schema: unknown) {
  const key = ({ at, construct }: { at: string; construct: string }) => `${at}\n${construct}`;
  return failuresOf(schema).toSorted((left, right) => key(left).localeCompare(key(right)));
}

function oneOf(at: string, construct: string, instead?: string) {
  const failure = { kind: 'not-allowed', at, construct };
  return instead === undefined ? failure : { ...failure, instead };
}

function sortedLines(...lines: readonly ReturnType<typeof oneOf>[]) {
  return lines.toSorted((left, right) =>
    `${left.at}\n${left.construct}`.localeCompare(`${right.at}\n${right.construct}`),
  );
}

describe('walkSchemas: what a reader refuses of its own stays beside a value that is no zod 4 schema', () => {
  test('a field named constructor keeps its line beside a zod/v3 field', () => {
    const order = z.object({ constructor: z.string(), x: z3.string() as never });

    expect(sortedFailuresOf(order)).toEqual(
      sortedLines(
        oneOf(
          'constructor',
          'a field named constructor, which every object already has (zod reads it from Object.prototype when it is absent)',
        ),
        oneOf('x', notZod4),
      ),
    );
  });

  test('a catchall keeps its line beside a zod/v3 field', () => {
    const order = z.object({ x: z3.string() as never }).catchall(z.string());

    expect(sortedFailuresOf(order)).toEqual(
      sortedLines(oneOf('', '.catchall()', 'z.record()'), oneOf('x', notZod4)),
    );
  });

  test('a nullable record key keeps its line beside a zod/v3 value', () => {
    const record = new z.ZodRecord({
      type: 'record',
      keyType: z.string().nullable() as never,
      valueType: z3.string() as never,
    });

    expect(sortedFailuresOf(record)).toEqual(
      sortedLines(oneOf('', 'a nullable z.record() key'), oneOf('{}', notZod4)),
    );
  });

  test('a zod/v3 field beside an optional field is the only refusal', () => {
    const order = z.object({ a: z3.string() as never, b: z.string().optional() });

    expect(sortedFailuresOf(order)).toEqual([oneOf('a', notZod4)]);
  });
});

describe('walkSchemas: a union holding a value that is no zod 4 schema', () => {
  const noLiteral = 'a discriminated union variant whose discriminator is not a literal';

  test('a variant’s zod/v3 field is refused at that field', () => {
    const payment = z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('card'), last4: z3.string() as never }),
    ]);

    expect(sortedFailuresOf(payment)).toEqual([oneOf('<kind="card">.last4', notZod4)]);
  });

  test('a zod/v3 discriminator is refused at its field', () => {
    const payment = z.discriminatedUnion('kind', [z.object({ kind: z3.literal('card') as never })]);

    expect(sortedFailuresOf(payment)).toEqual([oneOf('<|0>.kind', notZod4)]);
  });

  test('a discriminator key holding undefined is refused at its field alone, as null is', () => {
    const payment = z.discriminatedUnion('kind', [z.object({ kind: undefined as never })]);

    expect(sortedFailuresOf(payment)).toEqual([oneOf('<|0>.kind', notZod4)]);
  });

  test('a variant without the discriminator key is not a literal', () => {
    const payment = z.discriminatedUnion('kind', [
      z.lazy(() => z.object({ other: z.string() })) as never,
    ]);

    expect(sortedFailuresOf(payment)).toEqual([oneOf('<|0>', noLiteral)]);
  });

  test('a nullable zod/v3 discriminator is refused at its field, beside the variant', () => {
    const payment = z.discriminatedUnion('kind', [
      z.object({ kind: z.nullable(z3.literal('card') as never) }),
    ]);

    expect(sortedFailuresOf(payment)).toEqual(
      sortedLines(oneOf('<|0>', noLiteral), oneOf('<|0>.kind', notZod4)),
    );
  });

  test('a readonly variant keeps its lines beside its zod/v3 field', () => {
    const payment = z.discriminatedUnion('kind', [
      z.readonly(z.object({ kind: z.literal('card'), last4: z3.string() as never })) as never,
    ]);

    expect(sortedFailuresOf(payment)).toEqual(
      sortedLines(
        oneOf('<kind="card">', 'a discriminated union variant that is not an object'),
        oneOf('<kind="card">', '.readonly()'),
        oneOf('<kind="card">.last4', notZod4),
      ),
    );
  });

  test('a JSON-shaped union with a zod/v3 record key is refused at that key', () => {
    const json = z.union([
      z.string(),
      z.number(),
      z.boolean(),
      z.null(),
      z.array(z.string()),
      z.record(z3.string() as never, z.string()),
    ]);

    expect(sortedFailuresOf(json)).toEqual(
      sortedLines(oneOf('<|3>', 'z.null()', '.nullable()'), oneOf('<|5>{key}', notZod4)),
    );
  });
});

describe('a zod def as the walker reads it', () => {
  test('holds no schema it has judged: a lazy’s getter returns unknown', () => {
    type Lazy = Extract<Def, { readonly type: 'lazy' }>;

    expectTypeOf<ReturnType<Lazy['getter']>>().toEqualTypeOf<unknown>();
  });

  test('holds no schema it has judged: an object’s fields and a union’s options are unknown', () => {
    type ObjectDef = Extract<Def, { readonly type: 'object' }>;
    type UnionDef = Extract<Def, { readonly type: 'union' }>;

    expectTypeOf<ObjectDef['shape'][string]>().toEqualTypeOf<unknown>();
    expectTypeOf<UnionDef['options'][number]>().toEqualTypeOf<unknown>();
  });
});
