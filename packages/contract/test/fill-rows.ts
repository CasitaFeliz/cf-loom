import { z } from 'zod';
import { openEnum } from '../src/index.ts';
import type { RefusalKey } from '../src/internal/index.ts';

export type Schema = z.ZodType;

/**
 * A construct an author can write that the walk refuses, and for a refused call on a schema, the
 * schema without the call, which is the only fill that call is judged against. Which rows are
 * calls is read from the walk, never from this table.
 */
export type Row = {
  readonly make: () => unknown;
  readonly bare?: () => Schema;
  /** A row refused only as a variant of a discriminated union goes only where the slot is one. */
  readonly onlyIn?: 'variant';
};

/** Why no row builds a construct. */
export type Reason = { readonly reason: string };

let counter = 0;

/** An id no other row of the run takes. */
export function freshId(prefix: string): string {
  return `${prefix}${counter++}`;
}

/** An object on a cycle of its own, with the id given, shaped by `shape`. */
export function cyclic(id: string, shape: (object: Schema) => Schema = (object) => object): Schema {
  const def: Schema = shape(
    z.object({
      get next() {
        return def.optional();
      },
    }),
  ).meta({ id });
  return def;
}

const date = z.date();
const open = () => openEnum(['a']);
export const asRow = (make: () => unknown, bare?: () => Schema): Row =>
  bare ? { make, bare } : { make };
const inVariant = (make: () => unknown): Row => ({ make, onlyIn: 'variant' });
export const checked = (schema: Schema, check: unknown): Schema => schema.check(check as never);

/** Every construct the walk refuses by name, by the key of its row in `refused`. */
export const rows = {
  default: asRow(() => z.string().default('a')),
  prefault: asRow(() => z.string().prefault('a')),
  catch: asRow(() => z.string().catch('a')),
  transform: asRow(() => z.string().transform((value) => value)),
  preprocess: asRow(() => z.preprocess((value) => value, z.string())),
  pipe: asRow(() => z.string().pipe(z.string())),
  custom: asRow(() => z.custom<string>()),
  codec: asRow(() =>
    z.codec(z.string(), z.number(), { decode: (value) => Number(value), encode: String }),
  ),
  coerce: asRow(
    () => z.coerce.string(),
    () => z.string(),
  ),
  date: asRow(() => date),
  stringbool: asRow(() => z.stringbool()),
  templateLiteral: asRow(() => z.templateLiteral(['a'])),
  unknown: asRow(() => z.unknown()),
  any: asRow(() => z.any()),
  looseObject: asRow(() => z.looseObject({ a: z.string() })),
  catchall: asRow(() => z.object({ a: z.string() }).catchall(z.string())),
  strictObject: asRow(() => z.strictObject({ a: z.string() })),
  nullableRecordKey: asRow(() => z.record(z.string().nullable() as never, z.string())),
  openRecordKey: asRow(() => z.record(open(), z.string())),
  looseRecord: asRow(() => z.looseRecord(z.string(), z.string())),
  keyedRecord: asRow(() => z.record(z.enum(['a']), z.string())),
  recordKey: asRow(() => z.record(z.number() as never, z.string())),
  conditionalCheck: asRow(
    () => checked(z.string(), z.minLength(1, { when: () => true } as object as never)),
    () => z.string(),
  ),
  customPattern: asRow(
    () => z.email({ pattern: /^a/ }),
    () => z.email(),
  ),
  plainRegex: asRow(
    () => z.string().regex(Object.assign(/a/, { x: 1 })),
    () => z.string(),
  ),
  urlNormalize: asRow(
    () => z.url({ normalize: true }),
    () => z.url(),
  ),
  readonly: asRow(() => z.string().readonly()),
  numericEnum: asRow(() => z.enum({ one: 1 } as never)),
  emptyEnum: asRow(() => z.enum([] as never)),
  emptyUnion: asRow(() => z.union([] as never)),
  emptyDiscriminatedUnion: asRow(() => z.discriminatedUnion('k', [] as never)),
  optional: asRow(() => z.string().optional()),
  nonoptional: asRow(() => z.string().nonoptional()),
  null: asRow(() => z.null()),
  undefined: asRow(() => z.undefined()),
  literalNull: asRow(() => z.literal(null)),
  literalUndefined: asRow(() => z.literal(undefined)),
  nonJsonExamples: asRow(
    () => z.string().meta({ examples: [1n] as never }),
    () => z.string(),
  ),
  nonStringId: asRow(
    () => z.string().meta({ id: 5 as never }),
    () => z.string(),
  ),
  nonStringDescription: asRow(
    () => z.string().meta({ description: 5 as never }),
    () => z.string(),
  ),
  nonFinite: asRow(
    () => z.number().max(Number.POSITIVE_INFINITY),
    () => z.number(),
  ),
  nonPositiveMultipleOf: asRow(
    () => z.number().multipleOf(-1),
    () => z.number(),
  ),
  lengthBound: asRow(
    () => z.string().min(0.5),
    () => z.string(),
  ),
  crossedBounds: asRow(
    () => z.number().min(5).max(1),
    () => z.number(),
  ),
  literalBigint: asRow(() => z.literal(1n)),
  xor: asRow(() => z.xor([z.string(), z.number()])),
  severalDiscriminatorValues: inVariant(() => z.object({ k: z.literal(['a', 'c']) })),
  duplicateDiscriminatorValue: asRow(() =>
    z.discriminatedUnion('k', [z.object({ k: z.literal('a') }), z.object({ k: z.literal('a') })]),
  ),
  unliteralDiscriminator: inVariant(() => z.object({ k: z.string() })),
  objectlessVariant: inVariant(() => z.union([z.object({ k: z.literal('c') }), z.object({})])),
  nestedDiscriminatedUnion: inVariant(() =>
    z.discriminatedUnion('j', [z.object({ k: z.literal(['c', 'd']), j: z.literal('x') })]),
  ),
  differingIntersection: asRow(() =>
    z.intersection(z.object({ k: z.string() }), z.object({ k: z.number() })),
  ),
  openIntersection: { reason: 'a rule over a composition, which every row is judged beside' },
  openUnion: { reason: 'a rule over a composition, which every row is judged beside' },
  protoField: asRow(() =>
    z.object(Object.defineProperty({}, '__proto__', { value: z.string(), enumerable: true })),
  ),
  unnamedCycle: asRow(() => {
    const cycle: Schema = z.lazy(() => z.array(cycle));
    return cycle;
  }),
  notZod4: asRow(() => ({})),
  nodelessCycle: {
    reason:
      'a cycle among defs: its fix keeps the defs, so a use stays a ref, as the nodelessCycle context judges',
  },
  writtenTooDeep: { reason: 'the walk enters nothing under it, so nothing is judged beside it' },
  bigint: asRow(() => z.bigint()),
  symbol: asRow(() => z.symbol()),
  void: asRow(() => z.void()),
  never: asRow(() => z.never()),
  nan: asRow(() => z.nan()),
  map: asRow(() => z.map(z.string(), z.object({ e: open() }))),
  set: asRow(() => z.set(z.object({ e: open() }))),
  file: asRow(() => z.file()),
  promise: asRow(() => z.promise(z.object({ e: open() }))),
  function: asRow(() => z.function()),
  success: asRow(() => z.success(z.string())),
} as const satisfies Record<RefusalKey, Row | Reason>;
