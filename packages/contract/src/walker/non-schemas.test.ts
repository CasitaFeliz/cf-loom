import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { z as z3 } from 'zod/v3';
import type * as core from 'zod/v4/core';
import { refusalsOf } from '../../test/failures.ts';
import { authorPathOf, type Step, walkSchemas } from '../internal/index.ts';

const notZod4 = 'a value that is no zod 4 schema (zod/v3 is not read)';

function exportAt(name: string) {
  return { site: { kind: 'export', name }, declaration: undefined, steps: [] } as const;
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
};

const jsonOptions = [z.string(), z.number(), z.boolean(), z.null()] as const;
const stringKeyed = z.record(z.string(), z.string());

/** Every slot the walk reads a schema in, those the readers peek at before they enter included. */
const slots: readonly Slot[] = [
  { name: 'an object field', around: (child) => z.object({ a: child }), steps: [fieldAt('a')] },
  {
    name: 'a field’s .optional()',
    around: (child) => z.object({ a: z.optional(child) }),
    steps: [fieldAt('a')],
  },
  {
    name: 'a field’s .nonoptional()',
    around: (child) => z.object({ a: z.nonoptional(child) }),
    steps: [fieldAt('a')],
  },
  { name: 'a .nullable()', around: (child) => z.nullable(child), steps: [] },
  { name: 'an array’s items', around: (child) => z.array(child), steps: [itemsAt] },
  {
    name: 'a tuple’s item',
    around: (child) => z.tuple([child]),
    steps: [{ kind: 'index', index: 0 }],
  },
  {
    name: 'a tuple’s rest',
    around: (child) => new z.ZodTuple({ type: 'tuple', items: [z.string()], rest: child }),
    steps: [{ kind: 'rest' }],
    noneIs: null,
  },
  {
    name: 'a record’s value',
    around: (child) => new z.ZodRecord({ type: 'record', keyType: z.string(), valueType: child }),
    steps: [valueAt],
  },
  { name: 'a record’s key', around: (child) => z.record(child, z.string()), steps: [keyAt] },
  {
    name: 'a union’s option',
    around: (child) => z.union([z.string(), child]),
    steps: [optionAt(1)],
  },
  {
    name: 'an intersection’s side',
    around: (child) => z.intersection(child, z.object({})),
    steps: [{ kind: 'index', index: 0 }],
  },
  { name: 'a lazy’s result', around: (child) => z.lazy(() => child), steps: [] },
  {
    name: 'a pipe’s in',
    around: (child) => new z.ZodPipe({ type: 'pipe', in: child, out: z.string() }),
    steps: [],
  },
  {
    name: 'a pipe’s out',
    around: (child) => new z.ZodPipe({ type: 'pipe', in: z.string(), out: child }),
    steps: [],
  },
  { name: 'a .readonly()', around: (child) => z.readonly(child), steps: [] },
  { name: 'a set’s value', around: (child) => z.set(child), steps: [] },
  { name: 'a map’s value', around: (child) => z.map(z.string(), child), steps: [valueAt] },
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
  },
  {
    name: 'a field of a lazy discriminated union variant',
    around: (child) =>
      z.discriminatedUnion('k', [z.lazy(() => z.object({ k: z.literal('a'), x: child })) as never]),
    steps: [{ kind: 'variant', discriminator: 'k', value: '"a"' }, fieldAt('x')],
  },
  {
    name: 'a discriminated union’s discriminator',
    around: (child) => z.discriminatedUnion('k', [z.object({ k: child })]),
    steps: [optionAt(0), fieldAt('k')],
  },
  {
    name: 'a discriminated union’s variant',
    around: (child) => z.discriminatedUnion('k', [child]),
    steps: [optionAt(0)],
    onlyDirect: true,
  },
  {
    name: 'a discriminated union’s lazy variant',
    around: (child) => z.discriminatedUnion('k', [z.lazy(() => child) as never]),
    steps: [optionAt(0)],
    onlyDirect: true,
  },
  {
    name: 'a JSON-shaped union’s record key',
    around: (child) => z.union([...jsonOptions, z.array(z.string()), z.record(child, z.string())]),
    steps: [optionAt(5), keyAt],
  },
  {
    name: 'a JSON-shaped union’s array items',
    around: (child) => z.union([...jsonOptions, z.array(child), stringKeyed]),
    steps: [optionAt(4), itemsAt],
  },
  {
    name: 'a JSON-shaped union’s option',
    around: (child) => z.union([...jsonOptions, child, stringKeyed]),
    steps: [optionAt(4)],
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

/** What is wrong with the walk of a bad value at the end of these slots, none when all is well. */
function problemOf(nesting: Nesting, what: string, schema: unknown): string | undefined {
  const label = `${nesting.map(({ name }) => name).join(' > ')} :: ${what}`;
  const at = authorPathOf(nesting.flatMap(({ steps }) => steps)) ?? '';
  try {
    const failures = failuresOf(schema);
    const refused = failures.some((failure) => failure.at === at && failure.construct === notZod4);
    return refused ? undefined : `${label}: no refusal at ${at} in ${JSON.stringify(failures)}`;
  } catch (error) {
    return `${label}: threw ${String(error)}`;
  }
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
