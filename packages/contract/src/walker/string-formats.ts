import { z } from 'zod';
import type { BuiltDef, DeclaredCheck } from './check-defs.ts';
import { formatOptionsOf } from './format-options.ts';
import type { Path, StringNode } from './nodes.ts';
import { notAllowed, type Refused, refused, refusedStringFormat } from './not-allowed.ts';
import { type Walked, walked } from './walked.ts';

/** What the walker reads of a string format check, from zod and `zod/mini` alike. */
type FormatDef = BuiltDef & {
  readonly format: string;
  readonly pattern?: RegExp | undefined;
  readonly fn?: ((value: string) => unknown) | undefined;
  readonly normalize?: boolean | undefined;
};

const hashFormats = ['md5', 'sha1', 'sha256', 'sha384', 'sha512'].flatMap((algorithm) =>
  ['hex', 'base64', 'base64url'].map((encoding) => `${algorithm}_${encoding}`),
);

/** The formats zod builds itself, each by its own constructor from its options. */
const builtFormats: ReadonlySet<string> = new Set([
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
]);

/** The string checks zod writes as formats, which the Not allowed list names. */
const refusedByFormat: ReadonlyMap<string, Refused> = new Map<string, Refused>([
  ['starts_with', refused.startsWith],
  ['ends_with', refused.endsWith],
  ['includes', refused.includes],
  ['lowercase', refused.lowercase],
  ['uppercase', refused.uppercase],
]);

/** The formats zod builds from a regex, which a function of the author's could pose as. */
const regexFormats: ReadonlyMap<string, () => unknown> = new Map<string, () => unknown>([
  ['hex', () => z.hex()],
  ['hostname', () => z.hostname()],
  ['currency_code', () => z.currencyCode()],
  ...hashFormats.map((format): [string, () => unknown] => [format, () => hashOf(format)]),
]);

/**
 * The `format` and `formatOptions` a string format check declares: only a format zod builds
 * itself, checked as zod checks it, with the options that differ from zod's default.
 */
export function formatOf(check: DeclaredCheck, at: Path): Walked<Partial<StringNode>> {
  const def = check.def as unknown as FormatDef;
  const refusal = namedRefusalOf(def);
  if (refusal !== undefined) {
    return notAllowed(at, refusal);
  }
  if (regexFormats.has(def.format)) {
    return regexFormatOf(def, at);
  }
  return builtFormatOf(check, at);
}

function namedRefusalOf(def: FormatDef): Refused | undefined {
  const named = refusedByFormat.get(def.format);
  if (named !== undefined) {
    return named;
  }
  if (!builtFormats.has(def.format) && !regexFormats.has(def.format)) {
    return refusedStringFormat(def.format);
  }
  return def.normalize === true ? refused.urlNormalize : undefined;
}

/** A format zod builds from its options: the pattern must be the one zod builds for them. */
function builtFormatOf(check: DeclaredCheck, at: Path): Walked<Partial<StringNode>> {
  const def = check.def as unknown as FormatDef;
  if (def.fn !== undefined) {
    return notAllowed(at, refusedStringFormat(def.format));
  }
  const options = formatOptionsOf(check);
  if (options === undefined) {
    return notAllowed(at, refusedStringFormat(def.format));
  }
  if (options.kind === 'custom-pattern') {
    return notAllowed(at, refused.customPattern);
  }
  if (Object.keys(options.declared).length === 0) {
    return walked({ format: def.format });
  }
  return walked({ format: def.format, formatOptions: options.declared });
}

/** A format zod builds from a regex: zod's own function and zod's own regex, and no options. */
function regexFormatOf(def: FormatDef, at: Path): Walked<Partial<StringNode>> {
  const reference = referenceOf(def.format);
  if (reference === undefined || String(def.fn) !== String(reference.fn)) {
    return notAllowed(at, refusedStringFormat(def.format));
  }
  const samePattern =
    def.pattern?.source === reference.pattern?.source &&
    def.pattern?.flags === reference.pattern?.flags;
  return samePattern ? walked({ format: def.format }) : notAllowed(at, refused.customPattern);
}

function referenceOf(format: string): FormatDef | undefined {
  try {
    const schema = regexFormats.get(format)?.() as { _zod: { def: unknown } } | undefined;
    return schema?._zod.def as FormatDef | undefined;
  } catch {
    return undefined;
  }
}

function hashOf(format: string): unknown {
  const [algorithm, encoding] = format.split('_') as [
    'md5' | 'sha1' | 'sha256' | 'sha384' | 'sha512',
    'hex' | 'base64' | 'base64url',
  ];
  return z.hash(algorithm, { enc: encoding });
}
