import type { NotAllowed } from './nodes.ts';
import { type Failed, failed, type Outline, type Reached } from './walked.ts';
import { writtenNestingLimit } from './written-depth.ts';

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
  custom: { construct: '.refine(), z.custom() or z.instanceof()' },
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
  keyedRecord: {
    construct: 'a z.record() or z.partialRecord() keyed by an enum or literal',
    instead: 'z.object() with the keys as fields',
  },
  recordKey: { construct: 'a z.record() key that is not a string' },
  conditionalCheck: { construct: 'a conditional check' },
  customPattern: { construct: 'a format with a custom pattern' },
  urlNormalize: { construct: 'z.url({ normalize })' },
  readonly: { construct: '.readonly()' },
  numericEnum: { construct: 'numeric z.enum() values' },
  emptyEnum: { construct: 'a z.enum() or z.literal() without values' },
  emptyUnion: { construct: 'a z.union() without options' },
  emptyDiscriminatedUnion: { construct: 'a z.discriminatedUnion() without options' },
  optional: { construct: '.optional()' },
  nonoptional: { construct: '.nonoptional()' },
  null: { construct: 'z.null()', instead: nullableInstead },
  undefined: { construct: 'z.undefined()', instead: nullableInstead },
  literalNull: { construct: 'z.literal(null)', instead: nullableInstead },
  literalUndefined: { construct: 'z.literal(undefined)', instead: nullableInstead },
  nonJsonExamples: { construct: 'examples that are not JSON values' },
  nonStringId: { construct: '.meta({ id }) that is not a string' },
  nonStringDescription: { construct: '.meta({ description }) that is not a string' },
  nonFinite: { construct: 'a number that is not finite (NaN or Infinity)' },
  nonPositiveMultipleOf: { construct: 'a multipleOf of 0 or less' },
  lengthBound: { construct: 'a length bound that is not a non-negative integer' },
  crossedBounds: { construct: 'bounds that admit no value' },
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
  differingIntersection: {
    construct: 'an intersection of objects whose shared keys differ',
    instead: '.extend()',
  },
  openIntersection: {
    construct: 'an intersection that is not of open objects reaching an openEnum()',
    instead: '.extend()',
  },
  openUnion: {
    construct: 'a z.union() reaching an openEnum()',
    instead: 'z.discriminatedUnion(), or one openEnum() of all the values',
  },
  protoField: { construct: 'a field named __proto__ (zod drops it when parsing)' },
  unnamedCycle: { construct: 'a cycle without .meta({ id })', instead: '.meta({ id })' },
  nodelessCycle: {
    construct: 'a cycle through z.lazy(), unions and intersections alone, which zod cannot parse',
  },
  writtenTooDeep: {
    construct: `a schema nested deeper than ${writtenNestingLimit} schemas as written`,
  },
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

/** A field named what every object already has, which zod reads from the prototype when it is absent. */
export function refusedObjectNameField(name: string): Refused {
  return {
    construct: `a field named ${name}, which every object already has (zod reads it from Object.prototype when it is absent)`,
  };
}

/** A recursion id that is no camelCase name, so code could not name its def. */
export function refusedNonCamelCaseId(id: string): Refused {
  return { construct: `.meta({ id: ${JSON.stringify(id)} })`, instead: 'a camelCase name' };
}

/** A recursion id on a field's `.optional()` or `.nonoptional()`, which names no cycle. */
export function refusedWrapperId(wrapper: 'optional' | 'nonoptional'): Refused {
  return {
    construct: `.meta({ id }) on .${wrapper}()`,
    instead: '.meta({ id }) on the schema inside',
  };
}

/** A recursion id on a schema that lies on no cycle, though an id names a cycle. */
export function refusedAcyclicId(id: string): Refused {
  return {
    construct: `.meta({ id: ${JSON.stringify(id)} }) on a schema that lies on no cycle`,
    instead: '.meta({ id }) only on a recursive schema',
  };
}

/** A recursion id on a schema that admits `null`: `.nullable()` belongs to a use, so a def is never nullable. */
export function refusedNullableDef(id: string): Refused {
  return {
    construct: `.meta({ id: ${JSON.stringify(id)} }) on a schema that admits null`,
    instead: '.meta({ id }) on the schema inside, and .nullable() on each use',
  };
}

const checkInsideInstead = 'the check on the schema inside every .nullable() and .optional()';

/**
 * A check on a schema that admits `null`: a check belongs to the schema it constrains, and
 * whether zod runs it on `null` depends on each check, which no node says.
 */
export function refusedCheckOnNullable(check: string): Refused {
  return { construct: `${check} on a schema that admits null`, instead: checkInsideInstead };
}

/**
 * A check on a field's `.optional()`: a check belongs to the schema it constrains, and whether
 * zod runs it on an absent field depends on each check, which no field says.
 */
export function refusedCheckOnOptional(check: string): Refused {
  return { construct: `${check} on .optional()`, instead: checkInsideInstead };
}

/** A second schema named with an id another schema in the Snapshot already has. */
export function refusedDuplicateId(id: string): Refused {
  return { construct: `two schemas with .meta({ id: ${JSON.stringify(id)} })` };
}

/** An example its own schema refuses, by its place among the schema's examples. */
export function refusedExample(index: number): Refused {
  return { construct: `an example the schema refuses (examples[${index}])` };
}

/** A zod type the walker has no node for, by zod's id, since no call is known to build it. */
export function refusedZodType(type: string): Refused {
  return { construct: `a zod type ${JSON.stringify(type)}` };
}

/** Two checks that set one constraint, which a node holds once. */
export function refusedRepeatedCheck(constraint: string): Refused {
  return { construct: `two checks that set ${constraint}` };
}

/** A `z.stringFormat()` of a name zod does not build itself: a custom check. */
export function refusedStringFormat(format: string): Refused {
  return { construct: `z.stringFormat(${JSON.stringify(format)})` };
}

/**
 * A format zod builds from a regex and checks through a function, by the call that builds it: the
 * same regex in `.regex()` is a check zod runs from data.
 */
export function refusedRegexBuiltFormat(call: string, regex: string): Refused {
  return { construct: `${call}()`, instead: `.regex(z.regexes.${regex})` };
}

/** One failure, as the walk of a schema returns it, with the node the walk was building. */
export function notAllowed(at: Reached, construct: Refused, outline?: Outline): Failed {
  return failed([{ kind: 'not-allowed', ...at, ...construct }], outline);
}

/**
 * Whether a refusal is of a cycle no id names, which has no identity to share: each declaration's
 * walk meets it afresh, so it is told where that walk refused it.
 */
export function isUnnamedCycle({ construct }: NotAllowed): boolean {
  return construct === refused.unnamedCycle.construct;
}

/**
 * Whether a refusal is of a schema nested too deep as written, the one refusal that hides what lies
 * inside it: the walk does not enter it, so a cycle through it may close unseen.
 */
export function isWrittenTooDeep({ construct }: NotAllowed): boolean {
  return construct === refused.writtenTooDeep.construct;
}
