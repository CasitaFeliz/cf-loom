import { z } from 'zod';

/** A seeded generator of the same sequence every run, so a failing draw can be replayed. */
export function seededNext(seed: number): () => number {
  let state = seed;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

/** The draws a random schema is made of: a number below 1, and one of some values. */
type Draw = {
  readonly next: () => number;
  readonly pick: <Value>(values: readonly Value[]) => Value;
};

const numbers = [0, 1, 2, 3, 5, 0.5, -1, 10];

/**
 * Draws random zod schemas, nested up to a depth, from what a Contract commonly declares; each
 * member drawn passes through `annotate`, which draws from its own sequence, so one seed builds
 * the same tree with annotations or without.
 */
export function randomSchemas(
  next: () => number,
  annotate: (schema: z.ZodType) => z.ZodType = (schema) => schema,
) {
  const pick = <Value>(values: readonly Value[]): Value =>
    values[Math.floor(next() * values.length)] as Value;
  const draw: Draw = { next, pick };
  const schemaOf = (depth: number): z.ZodType =>
    annotate(
      depth <= 0 || next() < 0.3 ? aLeaf(draw) : aComposite(draw, () => schemaOf(depth - 1)),
    );
  return { schemaOf };
}

const exampleCandidates: readonly unknown[] = ['a', 'bb', 1, 2.5, true, null, [], {}];

/** Describes a schema, or gives it an example it parses, at random from `next`'s sequence. */
export function randomAnnotations(next: () => number) {
  return (schema: z.ZodType): z.ZodType => {
    const roll = next();
    if (roll < 0.3) {
      return schema.describe(next() < 0.5 ? 'p' : 'q');
    }
    const example = exampleCandidates.find((value) => schema.safeParse(value).success);
    return roll < 0.45 && example !== undefined ? schema.meta({ examples: [example] }) : schema;
  };
}

function aString({ next, pick }: Draw): z.ZodType {
  let schema = z.string();
  if (next() < 0.4) {
    schema = schema.min(pick([0, 1, 2, 3]));
  }
  if (next() < 0.4) {
    schema = schema.max(pick([1, 2, 3, 5]));
  }
  if (next() < 0.2) {
    schema = schema.regex(pick([/a/, /^b+$/i]));
  }
  return next() < 0.2 ? schema.describe(pick(['d', 'e'])) : schema;
}

function aNumber({ next, pick }: Draw): z.ZodType {
  let schema = z.number();
  if (next() < 0.4) {
    schema = schema.min(pick(numbers));
  }
  if (next() < 0.3) {
    schema = schema.lt(pick(numbers));
  }
  return next() < 0.3 ? schema.multipleOf(pick([1, 2, 0.5])) : schema;
}

function aLeaf(draw: Draw): z.ZodType {
  const { next, pick } = draw;
  const leaves: readonly (() => z.ZodType)[] = [
    () => aString(draw),
    () => aNumber(draw),
    () => (next() < 0.4 ? z.int().max(pick(numbers)) : z.int()),
    () => z.boolean(),
    () => z.enum(pick([['a', 'b'], ['b', 'a'], ['a']])),
    () => z.literal(pick(['a', 'b', 1, true])),
    () => pick([z.uuid(), z.email(), z.iso.datetime({ offset: true }), z.url(), z.ipv4()]),
    () => z.json(),
  ];
  return pick(leaves)();
}

function anObject({ next, pick }: Draw, inner: () => z.ZodType): z.ZodType {
  const fields: Record<string, z.ZodType> = {};
  const count = 1 + Math.floor(next() * 3);
  for (let index = 0; index < count; index += 1) {
    const field = inner();
    fields[pick(['a', 'b', 'c'])] = next() < 0.3 ? field.optional() : field;
  }
  return z.object(fields);
}

function aComposite(draw: Draw, inner: () => z.ZodType): z.ZodType {
  const { pick } = draw;
  const composites: readonly (() => z.ZodType)[] = [
    () => z.array(inner()).min(pick([0, 1, 2])),
    () => anObject(draw, inner),
    () => z.union([inner(), inner()]),
    () => z.union([z.literal(pick(['a', 'b'])), z.literal(pick(['a', 'b'])), z.literal('c')]),
    () => z.intersection(inner(), inner()),
    () => {
      const same = inner();
      return z.intersection(same, same);
    },
    () => z.record(pick([z.string(), z.string().min(1)]), inner()),
    () => z.tuple([inner(), inner()]),
    () => inner().nullable(),
  ];
  return pick(composites)();
}
