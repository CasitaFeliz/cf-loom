// biome-ignore-all lint/style/useNamingConvention: the keys are zod's ids of its check kinds and formats
import type * as core from 'zod/v4/core';
import { joinedOf } from '../lines/index.ts';
import type { CheckDef } from './check-defs.ts';
import { formatConstructorsOf, isStringFormat, type RegexBuiltFormat } from './format-schemas.ts';
import { type Refused, refused, refusedStringFormat } from './not-allowed.ts';

/** A check kind this walker was written for: every kind zod declares but those that set metadata. */
export type CheckKind = Exclude<CheckDef['check'], 'describe' | 'meta'>;

/** The names of a kind, by the variants its def tells apart. */
type Variants<Variant extends string> = Readonly<Record<Variant, string>>;

/** The string formats zod writes as methods, which no function of its name builds. */
type MethodFormat = (
  | core.$ZodCheckRegex
  | core.$ZodCheckStartsWith
  | core.$ZodCheckEndsWith
  | core.$ZodCheckIncludes
  | core.$ZodCheckLowerCase
  | core.$ZodCheckUpperCase
)['_zod']['def']['format'];

/** The kinds named by variant, and what tells their variants apart. */
type VariantRows = {
  readonly greater_than: Variants<'inclusive' | 'exclusive'>;
  readonly less_than: Variants<'inclusive' | 'exclusive'>;
  readonly number_format: Variants<core.$ZodNumberFormats>;
  readonly bigint_format: Variants<core.$ZodBigIntFormats>;
  readonly string_format: Variants<MethodFormat>;
  readonly custom: Variants<'refine' | 'check'>;
};

/** One name for a kind, or the names of its variants. */
type CheckNameRow<Kind extends CheckKind> = Kind extends keyof VariantRows
  ? VariantRows[Kind]
  : string;

/**
 * How the walk names each zod check it refuses, written once: every spelling that builds the check's
 * def, since the def keeps no record of which one the author wrote.
 */
export const checkNames = {
  greater_than: {
    inclusive: '.min(), .gte(), .nonnegative() or z.minimum()',
    exclusive: '.gt() or .positive()',
  },
  less_than: {
    inclusive: '.max(), .lte(), .nonpositive() or z.maximum()',
    exclusive: '.lt() or .negative()',
  },
  multiple_of: '.multipleOf() or .step()',
  number_format: {
    safeint: '.int() or .safe()',
    int32: 'z.int32()',
    uint32: 'z.uint32()',
    float32: 'z.float32()',
    float64: 'z.float64()',
  },
  bigint_format: { int64: 'z.int64()', uint64: 'z.uint64()' },
  max_size: '.max() or z.maxSize()',
  min_size: '.min(), .nonempty() or z.minSize()',
  size_equals: '.size()',
  max_length: '.max() or z.maxLength()',
  min_length: '.min(), .nonempty() or z.minLength()',
  length_equals: '.length()',
  string_format: {
    regex: '.regex()',
    starts_with: '.startsWith()',
    ends_with: '.endsWith()',
    includes: '.includes()',
    lowercase: '.lowercase()',
    uppercase: '.uppercase()',
  },
  property: 'z.property()',
  properties: 'z.properties()',
  mime_type: '.mime()',
  overwrite: '.trim(), .toLowerCase(), .toUpperCase(), .normalize(), .slugify() or .overwrite()',
  custom: {
    refine: refused.custom.construct,
    check: '.superRefine(), .check() or .with()',
  },
} as const satisfies { readonly [Kind in CheckKind]: CheckNameRow<Kind> };

/** The uuid versions zod has a function for, which that function and the option both build. */
const uuidNames: Readonly<Record<string, string>> = {
  v4: 'z.uuidv4() or z.uuid({ version: "v4" })',
  v6: 'z.uuidv6() or z.uuid({ version: "v6" })',
  v7: 'z.uuidv7() or z.uuid({ version: "v7" })',
};

/** Whether a check kind is one this walker was written for; zod may add one later. */
export function isKnownCheckKind(kind: string): kind is CheckKind {
  return Object.hasOwn(checkNames, kind);
}

/**
 * A check refused where it stands, named by the row its def keys; a kind, a format or a version zod
 * adds later is named by zod's ids, never by a call that may not exist.
 */
export function refusedCheck(check: CheckDef): Refused {
  return { construct: nameOf(check) };
}

function nameOf(check: CheckDef): string {
  if (!isKnownCheckKind(check.check)) {
    return zodCheckNamed(check.check);
  }
  const row: CheckNameRow<CheckKind> = checkNames[check.check];
  if (typeof row === 'string') {
    return row;
  }
  const variant = check.check === 'string_format' ? check.format : variantOf(check);
  return nameIn(row, variant) ?? unlistedName(check);
}

/** What tells a check apart within its kind, but a string format, which its format alone does. */
type Variant =
  | 'inclusive'
  | 'exclusive'
  | core.$ZodNumberFormats
  | core.$ZodBigIntFormats
  | 'refine'
  | 'check';

function variantOf(check: CheckDef): Variant | undefined {
  if (check.check === 'greater_than' || check.check === 'less_than') {
    return check.inclusive ? 'inclusive' : 'exclusive';
  }
  if (check.check === 'number_format' || check.check === 'bigint_format') {
    return check.format;
  }
  return check.check === 'custom' ? customVariantOf(check) : undefined;
}

function customVariantOf(check: Extract<CheckDef, { readonly check: 'custom' }>): Variant {
  return check.type === 'custom' ? 'refine' : 'check';
}

/** The name a kind's row gives a variant, none when it lists no such variant. */
function nameIn(
  names: Readonly<Record<string, string>>,
  variant: string | undefined,
): string | undefined {
  return variant !== undefined && Object.hasOwn(names, variant) ? names[variant] : undefined;
}

/** A check whose row lists no name for its format: a string format zod builds by name, or an id zod adds. */
function unlistedName(check: CheckDef): string {
  if (check.check === 'string_format') {
    return stringFormatName(check);
  }
  const format = 'format' in check ? ` of format ${JSON.stringify(check.format)}` : '';
  return `${zodCheckNamed(check.check)}${format}`;
}

function stringFormatName(check: Extract<CheckDef, { readonly check: 'string_format' }>): string {
  const { format } = check;
  const version = 'version' in check ? check.version : undefined;
  if (!isStringFormat(format)) {
    return refusedStringFormat(format).construct;
  }
  if (format === 'uuid' && version !== undefined) {
    return nameIn(uuidNames, version) ?? `z.uuid({ version: ${JSON.stringify(version)} })`;
  }
  return joinedOf(formatConstructorsOf(format).map(callOf), 'or');
}

/**
 * A format zod builds from a regex and checks through a function, named by every spelling that
 * builds it: the same regex in `.regex()` is a check zod runs from data.
 */
export function refusedRegexBuiltFormat({ format, calls, regexName }: RegexBuiltFormat): Refused {
  const stringFormat = `z.stringFormat("${format}")` as const;
  return {
    construct: joinedOf([...calls.map(callOf), stringFormat], 'or'),
    instead: `.regex(z.regexes.${regexName})`,
  };
}

function callOf<Call extends string>(call: Call): `${Call}()` {
  return `${call}()`;
}

function zodCheckNamed(kind: string): string {
  return `a zod check ${JSON.stringify(kind)}`;
}
