import { z } from 'zod';
import type * as core from 'zod/v4/core';
import type { BuiltDef, DeclaredCheck } from './check-defs.ts';
import { formatOptionsOf } from './format-options.ts';
import { type HashFormat, hashFormats, hashPartsOf, isHashFormat } from './hash-formats.ts';
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

/** The formats zod builds itself, each by its own constructor from its options. */
const builtFormats = [
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
] as const;

/** The formats zod builds from a regex alone, each with the zod that builds it. */
const regexFormatBuilders = {
  hex: () => z.hex(),
  hostname: () => z.hostname(),
  // biome-ignore lint/style/useNamingConvention: SNAPSHOT.md's name of the format
  currency_code: () => z.currencyCode(),
} as const satisfies Readonly<Record<string, () => core.$ZodType>>;

/** A format zod builds from a regex alone, a hash's aside. */
type RegexFormat = keyof typeof regexFormatBuilders;

/** A known string format, as SNAPSHOT.md names them: the ones zod builds itself. */
export type StringFormat = (typeof builtFormats)[number] | RegexFormat | HashFormat;

const knownFormats: ReadonlySet<string> = new Set<StringFormat>([
  ...builtFormats,
  ...Object.keys(regexFormatBuilders).filter(isRegexFormat),
  ...hashFormats,
]);

function isRegexFormat(format: string): format is RegexFormat {
  return Object.hasOwn(regexFormatBuilders, format);
}

/** A format check of a format SNAPSHOT.md knows. */
type KnownFormatDef = FormatDef & { readonly format: StringFormat };

/** Whether a format check names a format SNAPSHOT.md knows. */
function isKnownFormat(def: FormatDef): def is KnownFormatDef {
  return knownFormats.has(def.format);
}

/** The string checks zod writes as formats, which the Not allowed list names. */
const refusedByFormat: ReadonlyMap<string, Refused> = new Map<string, Refused>([
  ['starts_with', refused.startsWith],
  ['ends_with', refused.endsWith],
  ['includes', refused.includes],
  ['lowercase', refused.lowercase],
  ['uppercase', refused.uppercase],
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
  if (!isKnownFormat(def)) {
    return notAllowed(at, refusedStringFormat(def.format));
  }
  if (isRegexFormat(def.format) || isHashFormat(def.format)) {
    return regexFormatOf(def, at);
  }
  return builtFormatOf(check, def, at);
}

function namedRefusalOf(def: FormatDef): Refused | undefined {
  const named = refusedByFormat.get(def.format);
  if (named !== undefined) {
    return named;
  }
  return def.normalize === true ? refused.urlNormalize : undefined;
}

/** A format zod builds from its options: the pattern must be the one zod builds for them. */
function builtFormatOf(
  check: DeclaredCheck,
  def: KnownFormatDef,
  at: Path,
): Walked<Partial<StringNode>> {
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

/**
 * A format zod builds from a regex is judged by its pattern alone: zod's own regex for that
 * format, by source and flags, whatever function checks it, so any copy of zod compares alike;
 * one checked by a function alone is the author's `z.stringFormat()`.
 */
function regexFormatOf(def: KnownFormatDef, at: Path): Walked<Partial<StringNode>> {
  if (def.pattern === undefined) {
    return notAllowed(at, refusedStringFormat(def.format));
  }
  const zodPattern = referenceOf(def.format)?.pattern;
  const samePattern =
    zodPattern !== undefined &&
    def.pattern?.source === zodPattern.source &&
    def.pattern?.flags === zodPattern.flags;
  return samePattern ? walked({ format: def.format }) : notAllowed(at, refused.customPattern);
}

/** The format zod itself builds by that name, which a function of the author's could pose as. */
function referenceOf(format: StringFormat): FormatDef | undefined {
  const schema = referenceSchemaOf(format);
  return schema?._zod.def as FormatDef | undefined;
}

function referenceSchemaOf(format: StringFormat): core.$ZodType | undefined {
  if (isHashFormat(format)) {
    const { algorithm, encoding } = hashPartsOf(format);
    return z.hash(algorithm, { enc: encoding });
  }
  return isRegexFormat(format) ? regexFormatBuilders[format]() : undefined;
}
