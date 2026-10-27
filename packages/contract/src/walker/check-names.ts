// biome-ignore-all lint/style/useNamingConvention: the keys are zod's ids of its check kinds and formats
import type { CheckDef } from './check-defs.ts';
import { formatConstructorOf, isStringFormat } from './format-schemas.ts';
import { isHashFormat } from './hash-formats.ts';
import { type Refused, refusedStringFormat } from './not-allowed.ts';

/** A check kind this walker was written for: every kind zod declares but those that set metadata. */
export type CheckKind = Exclude<CheckDef['check'], 'describe' | 'meta'>;

/** One name for a kind, or names keyed by `inclusive`, the format or a custom check's `type`. */
type CheckNameRow = string | Readonly<Record<string, string>>;

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
    url: 'z.url() or z.httpUrl()',
  },
  property: 'z.property()',
  properties: 'z.properties()',
  mime_type: '.mime()',
  overwrite: '.trim(), .toLowerCase(), .toUpperCase(), .normalize(), .slugify() or .overwrite()',
  custom: {
    refine: '.refine(), z.custom() or z.instanceof()',
    check: '.superRefine(), .check() or .with()',
  },
} as const satisfies { readonly [Kind in CheckKind]: CheckNameRow };

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
  const row: CheckNameRow = checkNames[check.check];
  if (typeof row === 'string') {
    return row;
  }
  return nameIn(row, variantOf(check)) ?? unlistedName(check);
}

/** What tells a check apart within its kind: `inclusive`, a custom check's `type`, or its format. */
function variantOf(check: CheckDef): string | undefined {
  if ('inclusive' in check) {
    return check.inclusive ? 'inclusive' : 'exclusive';
  }
  if (check.check === 'custom') {
    return check.type === 'custom' ? 'refine' : 'check';
  }
  return 'format' in check ? check.format : undefined;
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
  return isHashFormat(format) ? 'z.hash()' : `${formatConstructorOf(format)}()`;
}

function zodCheckNamed(kind: string): string {
  return `a zod check ${JSON.stringify(kind)}`;
}
