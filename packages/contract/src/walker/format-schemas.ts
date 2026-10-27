import { z } from 'zod';
import type * as core from 'zod/v4/core';
import { type HashFormat, hashFormats, hashPartsOf, isHashFormat } from './hash-formats.ts';

/** A format's options as a Snapshot holds them, a regex as its source and flags. */
type FormatOptions = Readonly<Record<string, unknown>>;

/** zod's options of a format, as its constructor reads them. */
type ZodOptions = Readonly<Record<string, unknown>>;

/**
 * How zod builds a format: the call generated code writes, any other call that builds the same
 * format, and the schema those calls build.
 */
type FormatBuilder<Build> = {
  readonly call: string;
  readonly alsoBuiltBy?: readonly string[];
  readonly schema: Build;
};

/** How zod builds each format it builds from options, by the name SNAPSHOT.md gives it. */
const builtFormats = {
  guid: { call: 'z.guid', schema: (options) => z.guid(options) },
  uuid: { call: 'z.uuid', schema: (options) => z.uuid(options) },
  email: { call: 'z.email', schema: (options) => z.email(options) },
  url: { call: 'z.url', alsoBuiltBy: ['z.httpUrl'], schema: (options) => z.url(options) },
  emoji: { call: 'z.emoji', schema: (options) => z.emoji(options) },
  nanoid: { call: 'z.nanoid', schema: (options) => z.nanoid(options) },
  cuid: { call: 'z.cuid', schema: (options) => z.cuid(options) },
  cuid2: { call: 'z.cuid2', schema: (options) => z.cuid2(options) },
  ulid: { call: 'z.ulid', schema: (options) => z.ulid(options) },
  xid: { call: 'z.xid', schema: (options) => z.xid(options) },
  ksuid: { call: 'z.ksuid', schema: (options) => z.ksuid(options) },
  datetime: { call: 'z.iso.datetime', schema: (options) => z.iso.datetime(options) },
  date: { call: 'z.iso.date', schema: (options) => z.iso.date(options) },
  time: { call: 'z.iso.time', schema: (options) => z.iso.time(options) },
  duration: { call: 'z.iso.duration', schema: (options) => z.iso.duration(options) },
  ipv4: { call: 'z.ipv4', schema: (options) => z.ipv4(options) },
  ipv6: { call: 'z.ipv6', schema: (options) => z.ipv6(options) },
  mac: { call: 'z.mac', schema: (options) => z.mac(options) },
  cidrv4: { call: 'z.cidrv4', schema: (options) => z.cidrv4(options) },
  cidrv6: { call: 'z.cidrv6', schema: (options) => z.cidrv6(options) },
  base64: { call: 'z.base64', schema: (options) => z.base64(options) },
  base64url: { call: 'z.base64url', schema: (options) => z.base64url(options) },
  e164: { call: 'z.e164', schema: (options) => z.e164(options) },
  // biome-ignore lint/style/useNamingConvention: SNAPSHOT.md's name of the format
  credit_card: { call: 'z.creditCard', schema: (options) => z.creditCard(options) },
  iban: { call: 'z.iban', schema: (options) => z.iban(options) },
  jwt: { call: 'z.jwt', schema: (options) => z.jwt(options) },
} as const satisfies Readonly<
  Record<string, FormatBuilder<(options: ZodOptions) => core.$ZodType>>
>;

/** The formats zod builds from a regex alone, each with the zod that builds it. */
const regexFormats = {
  hex: { call: 'z.hex', schema: () => z.hex() },
  hostname: { call: 'z.hostname', schema: () => z.hostname() },
  // biome-ignore lint/style/useNamingConvention: SNAPSHOT.md's name of the format
  currency_code: { call: 'z.currencyCode', schema: () => z.currencyCode() },
} as const satisfies Readonly<Record<string, FormatBuilder<() => core.$ZodType>>>;

/** A format zod builds itself from its options, a regex-built one's aside. */
type BuiltFormat = keyof typeof builtFormats;

/** A format zod builds from a regex alone, a hash's aside. */
type RegexFormat = keyof typeof regexFormats;

/** A known string format, as SNAPSHOT.md names them: the ones zod builds itself. */
export type StringFormat = BuiltFormat | RegexFormat | HashFormat;

const knownFormats: ReadonlySet<string> = new Set([
  ...Object.keys(builtFormats),
  ...Object.keys(regexFormats),
  ...hashFormats,
]);

/** Whether a value names a string format SNAPSHOT.md knows. */
export function isStringFormat(value: unknown): value is StringFormat {
  return typeof value === 'string' && knownFormats.has(value);
}

/** A format zod builds by a function of its name. */
type ConstructedFormat = Exclude<StringFormat, HashFormat>;

/** The zod function that builds a format by its name, as generated code calls it. */
export function formatConstructorOf(format: ConstructedFormat): string {
  return constructedFormatOf(format).call;
}

/** Every zod function that builds a format by its name, the one generated code calls first. */
export function formatConstructorsOf(format: ConstructedFormat): readonly string[] {
  const constructed = constructedFormatOf(format);
  return 'alsoBuiltBy' in constructed
    ? [constructed.call, ...constructed.alsoBuiltBy]
    : [constructed.call];
}

function constructedFormatOf(format: ConstructedFormat) {
  return isBuiltFormat(format) ? builtFormats[format] : regexFormats[format];
}

/** Whether a format is one zod builds from a regex alone, a hash's aside. */
export function isRegexFormat(format: string): format is RegexFormat {
  return Object.hasOwn(regexFormats, format);
}

/** The schema zod builds for a format it builds from a regex alone, or `undefined` for any other. */
export function regexFormatSchemaOf(format: StringFormat): core.$ZodType | undefined {
  if (isHashFormat(format)) {
    const { algorithm, encoding } = hashPartsOf(format);
    return z.hash(algorithm, { enc: encoding });
  }
  return isRegexFormat(format) ? regexFormats[format].schema() : undefined;
}

/**
 * The schema zod builds for a known format with the options a Snapshot holds for it, so a text
 * is judged by that format as the author's own zod would; `undefined` when zod refuses them.
 */
export function formatSchemaOf(
  format: StringFormat,
  options: FormatOptions,
): core.$ZodType | undefined {
  if (!isBuiltFormat(format)) {
    return regexFormatSchemaOf(format);
  }
  try {
    return builtFormats[format].schema(zodOptionsOf(options));
  } catch {
    return undefined;
  }
}

function isBuiltFormat(format: StringFormat): format is BuiltFormat {
  return Object.hasOwn(builtFormats, format);
}

/** A Snapshot's format options as zod reads them: a regex back from its source and flags. */
function zodOptionsOf(options: FormatOptions): ZodOptions {
  const entries = Object.entries(options).map(([key, value]) => [key, zodValueOf(value)]);
  return Object.fromEntries(entries);
}

function zodValueOf(value: unknown): unknown {
  if (typeof value !== 'object' || value === null) {
    return value;
  }
  const source = Reflect.get(value, 'source');
  const flags = Reflect.get(value, 'flags');
  return typeof source === 'string' && typeof flags === 'string'
    ? new RegExp(source, flags)
    : value;
}
