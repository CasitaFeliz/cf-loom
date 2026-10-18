import type * as core from 'zod/v4/core';
import { regexes } from 'zod/v4/core';
import type { Path, StringNode, Walked } from './nodes.ts';
import { notAllowed, type Refused, refused, refusedStringFormat, walked } from './not-allowed.ts';

const hashFormats = ['md5', 'sha1', 'sha256', 'sha384', 'sha512'].flatMap((algorithm) =>
  ['hex', 'base64', 'base64url'].map((encoding) => `${algorithm}_${encoding}`),
);

/** The formats zod builds itself; any other name is a `z.stringFormat()`, a custom check. */
const knownFormats: ReadonlySet<string> = new Set([
  'guid',
  'uuid',
  'email',
  'url',
  'emoji',
  'nanoid',
  'cuid',
  'cuid2',
  'ulid',
  'xid',
  'ksuid',
  'datetime',
  'date',
  'time',
  'duration',
  'ipv4',
  'ipv6',
  'mac',
  'cidrv4',
  'cidrv6',
  'base64',
  'base64url',
  'e164',
  'credit_card',
  'iban',
  'jwt',
  'hex',
  'hostname',
  'currency_code',
  ...hashFormats,
]);

/** The keys every format check has, which say how zod checks it rather than what was declared. */
const checkKeys: ReadonlySet<string> = new Set([
  'type',
  'check',
  'format',
  'pattern',
  'abort',
  'error',
  'when',
  'checks',
  'coerce',
  'fn',
]);

/**
 * The `format` and `formatOptions` a string format check declares; an option left at what zod
 * assumes (`false`, `null`) is not declared.
 */
export function formatOf(
  check: core.$ZodCheckStringFormatDef,
  at: Path,
): Walked<Partial<StringNode>> {
  const refusal = refusalOf(check);
  if (refusal !== undefined) {
    return notAllowed(at, refusal);
  }
  const options = Object.entries(check).filter(isDeclaredOption).map(optionValue);
  if (options.length === 0) {
    return walked({ format: check.format });
  }
  return walked({ format: check.format, formatOptions: Object.fromEntries(options) });
}

function refusalOf(check: core.$ZodCheckStringFormatDef): Refused | undefined {
  switch (check.format) {
    case 'starts_with':
      return refused.startsWith;
    case 'ends_with':
      return refused.endsWith;
    case 'includes':
      return refused.includes;
    case 'lowercase':
      return refused.lowercase;
    case 'uppercase':
      return refused.uppercase;
  }
  if (!knownFormats.has(check.format)) {
    return refusedStringFormat(check.format);
  }
  if (check.format === 'email' && !isDefaultPattern(check.pattern, regexes.email)) {
    return refused.emailPattern;
  }
  if ('normalize' in check && check.normalize === true) {
    return refused.urlNormalize;
  }
  return undefined;
}

function isDefaultPattern(pattern: RegExp | undefined, zodDefault: RegExp): boolean {
  return pattern?.source === zodDefault.source && pattern.flags === zodDefault.flags;
}

function isDeclaredOption([key, value]: [string, unknown]): boolean {
  return !checkKeys.has(key) && value !== undefined && value !== null && value !== false;
}

function optionValue([key, value]: [string, unknown]): [string, unknown] {
  if (value instanceof RegExp) {
    return [key, { source: value.source, flags: value.flags }];
  }
  return [key, value];
}
