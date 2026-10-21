import type { Path } from './nodes.ts';
import type { Walked } from './walked.ts';

/** A construct as the Not allowed list writes it, and what the documents name instead. */
export type Refused = { readonly construct: string; readonly instead?: string };

const nullableInstead = '.nullable()';
const dynamicKeysInstead = 'z.record()';

/** Every construct the walker refuses by name, so each is written once. */
export const refused = {
  default: { construct: '.default()' },
  prefault: { construct: '.prefault()' },
  catch: { construct: '.catch()' },
  transform: { construct: '.transform()' },
  preprocess: { construct: '.preprocess()' },
  pipe: { construct: '.pipe()' },
  refine: { construct: '.refine()' },
  customCheck: { construct: '.superRefine() or .check()' },
  custom: { construct: 'z.custom()' },
  codec: { construct: 'z.codec()' },
  coerce: { construct: 'z.coerce.*' },
  date: { construct: 'z.date()', instead: 'z.iso.datetime()' },
  stringbool: { construct: 'z.stringbool()' },
  templateLiteral: { construct: 'z.templateLiteral()' },
  unknown: { construct: 'z.unknown()', instead: 'z.record() or z.json()' },
  any: { construct: 'z.any()', instead: 'z.record() or z.json()' },
  looseObject: { construct: 'z.looseObject() or .passthrough()', instead: dynamicKeysInstead },
  catchall: { construct: '.catchall()', instead: dynamicKeysInstead },
  strictObject: { construct: 'z.strictObject()', instead: 'z.object(): objects are open' },
  nullableRecordKey: { construct: 'a nullable z.record() key' },
  openRecordKey: {
    construct: 'a z.record() keyed by an openEnum()',
    instead: 'z.record(z.string(), …)',
  },
  looseRecord: { construct: 'z.looseRecord()' },
  keyedRecordAsQueryOrHeaders: {
    construct: 'a record keyed by an enum or literal as query or headers',
    instead: 'z.object()',
  },
  keyedRecordInReadShape: {
    construct: 'a record keyed by an enum or literal in a Read shape',
    instead: 'z.object() or a string-keyed z.record()',
  },
  recordKey: { construct: 'a z.record() key that is not a string, an enum or a literal' },
  mutating: { construct: '.trim(), .toLowerCase(), .toUpperCase(), .normalize() or .overwrite()' },
  startsWith: { construct: '.startsWith()' },
  endsWith: { construct: '.endsWith()' },
  includes: { construct: '.includes()' },
  lowercase: { construct: '.lowercase()' },
  uppercase: { construct: '.uppercase()' },
  conditionalCheck: { construct: 'a conditional check' },
  customPattern: { construct: 'a format with a custom pattern' },
  urlNormalize: { construct: 'z.url({ normalize })' },
  readonly: { construct: '.readonly()' },
  numericEnum: { construct: 'numeric z.enum() values' },
  optional: { construct: '.optional()' },
  nonoptional: { construct: '.nonoptional()' },
  null: { construct: 'z.null()', instead: nullableInstead },
  undefined: { construct: 'z.undefined()', instead: nullableInstead },
  literalNull: { construct: 'z.literal(null)', instead: nullableInstead },
  literalUndefined: { construct: 'z.literal(undefined)', instead: nullableInstead },
  nonJsonExamples: { construct: 'examples that are not JSON values' },
  nonFinite: { construct: 'a number that is not finite (NaN or Infinity)' },
  literalBigint: { construct: 'a bigint z.literal()' },
  xor: { construct: 'z.xor()' },
  severalDiscriminatorValues: {
    construct: 'a discriminated union variant whose discriminator has several values',
  },
  duplicateDiscriminatorValue: {
    construct: 'two discriminated union variants with the same discriminator value',
  },
  unliteralDiscriminator: {
    construct: 'a discriminated union variant whose discriminator is not a literal',
  },
  objectlessVariant: { construct: 'a discriminated union variant that is not an object' },
  nestedDiscriminatedUnion: { construct: 'a discriminated union as a variant of another' },
  keyedRecordIntersection: {
    construct: 'an intersection with a record keyed by an enum or literal',
    instead: 'z.object() with the keys as fields, then .extend()',
  },
  differingIntersection: {
    construct: 'an intersection of objects whose shared keys differ',
    instead: '.extend()',
  },
  openIntersection: {
    construct: 'an intersection that is not of open objects reaching an openEnum()',
    instead: '.extend()',
  },
  protoField: { construct: 'a field named __proto__ (zod drops it when parsing)' },
  unnamedCycle: { construct: 'a cycle without .meta({ id })', instead: '.meta({ id })' },
  lazyCycle: { construct: 'a cycle through z.lazy() alone, which zod cannot parse' },
  bigint: { construct: 'z.bigint()' },
  symbol: { construct: 'z.symbol()' },
  void: { construct: 'z.void()' },
  never: { construct: 'z.never()' },
  nan: { construct: 'z.nan()' },
  map: { construct: 'z.map()' },
  set: { construct: 'z.set()' },
  file: { construct: 'z.file()' },
  promise: { construct: 'z.promise()' },
  function: { construct: 'z.function()' },
  success: { construct: 'z.success()' },
} as const satisfies Record<string, Refused>;

/** A `.meta()` key other than `description`, `examples` and `id`. */
export function refusedMetaKey(key: string): Refused {
  return { construct: `.meta({ ${key} })` };
}

/** Examples that are not a list, which no JSON Schema reader could take. */
export const refusedExamples: Refused = { construct: '.meta({ examples }) that is not a list' };

/** A second schema named with an id another schema in the Snapshot already has. */
export function refusedDuplicateId(id: string): Refused {
  return { construct: `two schemas with .meta({ id: ${JSON.stringify(id)} })` };
}

/** A check, or a zod type, the walker has no node or constraint for, by its zod name. */
export function refusedName(name: string): Refused {
  return { construct: `z.${name}()` };
}

/** Two checks that set one constraint, which a node holds once. */
export function refusedRepeatedCheck(constraint: string): Refused {
  return { construct: `two checks that set ${constraint}` };
}

/** A `z.stringFormat()` of a name zod does not build itself: a custom check. */
export function refusedStringFormat(format: string): Refused {
  return { construct: `z.stringFormat(${JSON.stringify(format)})` };
}

/** One failure, as the walk of a schema returns it. */
export function notAllowed(at: Path, construct: Refused): Walked<never> {
  return { kind: 'not-allowed', failures: [{ kind: 'not-allowed', at, ...construct }] };
}
