import { z } from 'zod';
import type * as core from 'zod/v4/core';
import { canonicalJson } from './canonical-json.ts';
import type { Path, StringNode } from './nodes.ts';
import { notAllowed, type Refused, refused, refusedStringFormat } from './not-allowed.ts';
import { type Walked, walked } from './walked.ts';

/** What the walker reads of a string format check, from zod and `zod/mini` alike. */
type FormatDef = {
  readonly format: string;
  readonly pattern?: RegExp | undefined;
  readonly fn?: ((value: string) => unknown) | undefined;
  readonly normalize?: boolean | undefined;
};

/** How zod builds a format from its options, to compare a declared format with zod's own. */
type Factory = (options: object) => core.$ZodType;

type Option = [string, unknown];

/** A format as declared, with how zod builds it and what zod assumes when nothing is said. */
type DeclaredFormat = {
  readonly factory: Factory;
  readonly declared: readonly Option[];
  readonly defaults: FormatDef;
};

const hashFactories = (['md5', 'sha1', 'sha256', 'sha384', 'sha512'] as const).flatMap(
  (algorithm) =>
    (['hex', 'base64', 'base64url'] as const).map((encoding): [string, Factory] => [
      `${algorithm}_${encoding}`,
      (options) => z.hash(algorithm, { ...options, enc: encoding }),
    ]),
);

/** The formats zod builds itself; any other name is a `z.stringFormat()`, a custom check. */
const factoryByFormat: ReadonlyMap<string, Factory> = new Map<string, Factory>([
  ['guid', z.guid],
  ['uuid', z.uuid],
  ['email', z.email],
  ['url', z.url],
  ['emoji', z.emoji],
  ['nanoid', z.nanoid],
  ['cuid', z.cuid],
  ['cuid2', z.cuid2],
  ['ulid', z.ulid],
  ['xid', z.xid],
  ['ksuid', z.ksuid],
  ['datetime', z.iso.datetime],
  ['date', z.iso.date],
  ['time', z.iso.time],
  ['duration', z.iso.duration],
  ['ipv4', z.ipv4],
  ['ipv6', z.ipv6],
  ['mac', z.mac],
  ['cidrv4', z.cidrv4],
  ['cidrv6', z.cidrv6],
  ['base64', z.base64],
  ['base64url', z.base64url],
  ['e164', z.e164],
  ['credit_card', z.creditCard],
  ['iban', z.iban],
  ['jwt', z.jwt],
  ['hex', z.hex],
  ['hostname', z.hostname],
  ['currency_code', z.currencyCode],
  ...hashFactories,
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
 * The `format` and `formatOptions` a string format check declares: only a format zod builds
 * itself, checked as zod checks it, with the options that differ from zod's default.
 */
export function formatOf(check: FormatDef, at: Path): Walked<Partial<StringNode>> {
  const factory = factoryByFormat.get(check.format);
  const declared = Object.entries(check).filter(isOption);
  const reference =
    factory === undefined ? undefined : formatDefOf(factory(Object.fromEntries(declared)));
  const refusal = refusalOf(check, reference);
  if (refusal !== undefined || factory === undefined || reference === undefined) {
    return notAllowed(at, refusal ?? refusedStringFormat(check.format));
  }
  const format = { factory, declared, defaults: formatDefOf(factory({})) };
  const options = declared.filter((option) => isNonDefault(option, format));
  if (options.length === 0) {
    return walked({ format: check.format });
  }
  return walked({
    format: check.format,
    formatOptions: Object.fromEntries(options.map(jsonOption)),
  });
}

function refusalOf(check: FormatDef, reference: FormatDef | undefined): Refused | undefined {
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
  if (reference === undefined || !sameCheckFunction(check, reference)) {
    return refusedStringFormat(check.format);
  }
  if (!samePattern(check.pattern, reference.pattern)) {
    return refused.customPattern;
  }
  return check.normalize === true ? refused.urlNormalize : undefined;
}

/**
 * Whether an option changes the format: it differs from zod's default value, and dropping it
 * changes the pattern zod builds, when zod builds one.
 */
function isNonDefault(option: Option, format: DeclaredFormat): boolean {
  const [key, value] = option;
  const { factory, declared, defaults } = format;
  const defaultValue: unknown = Object.entries(defaults).find(([name]) => name === key)?.[1];
  if (canonicalJson(jsonOption([key, value])) === canonicalJson(jsonOption([key, defaultValue]))) {
    return false;
  }
  const withOption = formatDefOf(factory(Object.fromEntries(declared)));
  if (withOption.pattern === undefined) {
    return true;
  }
  const others = declared.filter(([name]) => name !== key);
  const withoutOption = formatDefOf(factory(Object.fromEntries(others)));
  return !samePattern(withOption.pattern, withoutOption.pattern);
}

/** A format built from a function is zod's own only when zod built that function. */
function sameCheckFunction(check: FormatDef, reference: FormatDef): boolean {
  return String(check.fn) === String(reference.fn);
}

function formatDefOf(schema: core.$ZodType): FormatDef {
  return schema._zod.def as unknown as FormatDef;
}

function samePattern(left: RegExp | undefined, right: RegExp | undefined): boolean {
  return left?.source === right?.source && left?.flags === right?.flags;
}

function isOption([key, value]: Option): boolean {
  return !checkKeys.has(key) && value !== undefined;
}

function jsonOption([key, value]: Option): Option {
  if (value instanceof RegExp) {
    return [key, { source: value.source, flags: value.flags }];
  }
  return [key, value];
}
