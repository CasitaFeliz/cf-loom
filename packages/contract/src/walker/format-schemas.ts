import { z } from 'zod';
import type * as core from 'zod/v4/core';
import { type BuiltFormat, regexFormatSchemaOf, type StringFormat } from './string-formats.ts';

/** A format's options as a Snapshot holds them, a regex as its source and flags. */
type FormatOptions = Readonly<Record<string, unknown>>;

/** zod's options of a format, as its constructor reads them. */
type ZodOptions = Readonly<Record<string, unknown>>;

/** How zod builds each format it builds from options, by the name SNAPSHOT.md gives it. */
const builtFormatSchemas = {
  guid: (options) => z.guid(options),
  uuid: (options) => z.uuid(options),
  email: (options) => z.email(options),
  url: (options) => z.url(options),
  emoji: (options) => z.emoji(options),
  nanoid: (options) => z.nanoid(options),
  cuid: (options) => z.cuid(options),
  cuid2: (options) => z.cuid2(options),
  ulid: (options) => z.ulid(options),
  xid: (options) => z.xid(options),
  ksuid: (options) => z.ksuid(options),
  datetime: (options) => z.iso.datetime(options),
  date: (options) => z.iso.date(options),
  time: (options) => z.iso.time(options),
  duration: (options) => z.iso.duration(options),
  ipv4: (options) => z.ipv4(options),
  ipv6: (options) => z.ipv6(options),
  mac: (options) => z.mac(options),
  cidrv4: (options) => z.cidrv4(options),
  cidrv6: (options) => z.cidrv6(options),
  base64: (options) => z.base64(options),
  base64url: (options) => z.base64url(options),
  e164: (options) => z.e164(options),
  // biome-ignore lint/style/useNamingConvention: SNAPSHOT.md's name of the format
  credit_card: (options) => z.creditCard(options),
  iban: (options) => z.iban(options),
  jwt: (options) => z.jwt(options),
} as const satisfies Readonly<Record<BuiltFormat, (options: ZodOptions) => core.$ZodType>>;

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
    return builtFormatSchemas[format](zodOptionsOf(options));
  } catch {
    return undefined;
  }
}

function isBuiltFormat(format: StringFormat): format is BuiltFormat {
  return Object.hasOwn(builtFormatSchemas, format);
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
