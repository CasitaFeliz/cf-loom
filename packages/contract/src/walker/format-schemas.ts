import { z } from 'zod';
import type * as core from 'zod/v4/core';

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

/** A known string format, as SNAPSHOT.md names them: the ones zod builds itself from options. */
export type StringFormat = keyof typeof builtFormats;

/** Whether a value names a string format SNAPSHOT.md knows. */
export function isStringFormat(value: unknown): value is StringFormat {
  return typeof value === 'string' && Object.hasOwn(builtFormats, value);
}

/** A zod function that builds a format by its name: the one generated code calls, or another that builds it too. */
export type ConstructorCall =
  | (typeof builtFormats)[StringFormat]['call']
  | AlsoBuiltBy<(typeof builtFormats)[StringFormat]>;

type AlsoBuiltBy<Built> = Built extends { readonly alsoBuiltBy: readonly (infer Call)[] }
  ? Call
  : never;

const hashAlgorithms = ['md5', 'sha1', 'sha256', 'sha384', 'sha512'] as const;
const hashEncodings = ['hex', 'base64', 'base64url'] as const;

type HashName = `${(typeof hashAlgorithms)[number]}_${(typeof hashEncodings)[number]}`;

/** The name zod gives a check of a format it builds from a regex. */
type RegexBuiltName = 'hex' | 'hostname' | 'currency_code' | HashName;

/**
 * A format zod builds from a regex and checks through a function: its name, the calls that build
 * it and its regex in `z.regexes`, each a literal so a line that spells them holds no text from
 * outside cf-loom.
 */
export type RegexBuiltFormat = {
  readonly format: RegexBuiltName;
  readonly calls: readonly ('z.hex' | 'z.hostname' | 'z.currencyCode' | 'z.hash')[];
  readonly regexName: string;
};

/**
 * The formats zod builds from a regex, by the name zod gives each check: their check runs a
 * function, so the walk refuses them and names the `z.regexes` pattern that `.regex()` takes.
 */
const regexBuiltFormats: ReadonlyMap<string, RegexBuiltFormat> = new Map([
  ['hex', { format: 'hex', calls: ['z.hex'], regexName: 'hex' }],
  ['hostname', { format: 'hostname', calls: ['z.hostname'], regexName: 'hostname' }],
  [
    'currency_code',
    { format: 'currency_code', calls: ['z.currencyCode'], regexName: 'currencyCode' },
  ],
  ...hashAlgorithms.flatMap((algorithm) =>
    hashEncodings.map((encoding): [string, RegexBuiltFormat] => {
      const name: HashName = `${algorithm}_${encoding}`;
      return [name, { format: name, calls: ['z.hash'], regexName: name }];
    }),
  ),
]);

/** The format zod builds from a regex by this name, if it is one. */
export function regexBuiltFormatOf(format: string): RegexBuiltFormat | undefined {
  return regexBuiltFormats.get(format);
}

/** The zod function that builds a format by its name, as generated code calls it. */
export function formatConstructorOf(format: StringFormat): string {
  return builtFormats[format].call;
}

/** Every zod function that builds a format by its name, the one generated code calls first. */
export function formatConstructorsOf(format: StringFormat): readonly ConstructorCall[] {
  const built: (typeof builtFormats)[StringFormat] = builtFormats[format];
  return 'alsoBuiltBy' in built ? [built.call, ...built.alsoBuiltBy] : [built.call];
}

/**
 * The schema zod builds for a known format with the options a Snapshot holds for it, so a text
 * is judged by that format as the author's own zod would; `undefined` when zod refuses them.
 */
export function formatSchemaOf(
  format: StringFormat,
  options: FormatOptions,
): core.$ZodType | undefined {
  try {
    return builtFormats[format].schema(zodOptionsOf(options));
  } catch {
    return undefined;
  }
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
