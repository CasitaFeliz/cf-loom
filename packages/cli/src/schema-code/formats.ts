import type { StringFormat } from '@casitafeliz/loom-contract/internal';

/** A hash format, its algorithm and encoding in its name. */
type HashFormat = Extract<StringFormat, `${string}_${'hex' | 'base64' | 'base64url'}`>;

/** The zod constructor of each format zod builds by name, as generated code calls it. */
const constructorByFormat: Readonly<Record<Exclude<StringFormat, HashFormat>, string>> = {
  guid: 'z.guid',
  uuid: 'z.uuid',
  email: 'z.email',
  url: 'z.url',
  emoji: 'z.emoji',
  nanoid: 'z.nanoid',
  cuid: 'z.cuid',
  cuid2: 'z.cuid2',
  ulid: 'z.ulid',
  xid: 'z.xid',
  ksuid: 'z.ksuid',
  datetime: 'z.iso.datetime',
  date: 'z.iso.date',
  time: 'z.iso.time',
  duration: 'z.iso.duration',
  ipv4: 'z.ipv4',
  ipv6: 'z.ipv6',
  mac: 'z.mac',
  cidrv4: 'z.cidrv4',
  cidrv6: 'z.cidrv6',
  base64: 'z.base64',
  base64url: 'z.base64url',
  e164: 'z.e164',
  // biome-ignore lint/style/useNamingConvention: SNAPSHOT.md's name of the format
  credit_card: 'z.creditCard',
  iban: 'z.iban',
  jwt: 'z.jwt',
  hex: 'z.hex',
  hostname: 'z.hostname',
  // biome-ignore lint/style/useNamingConvention: SNAPSHOT.md's name of the format
  currency_code: 'z.currencyCode',
};

const hashFormat = /^(md5|sha1|sha256|sha384|sha512)_(hex|base64|base64url)$/;

/**
 * The zod call that builds a format with the options the Snapshot records, so the generated
 * schema checks exactly what the author's did.
 */
export function formatCallOf(
  format: StringFormat,
  options: Readonly<Record<string, unknown>> | undefined,
): string {
  if (isHashFormat(format)) {
    const [algorithm, encoding] = format.split('_');
    return `z.hash('${algorithm}', { enc: '${encoding}' })`;
  }
  const call = constructorByFormat[format];
  return options === undefined ? `${call}()` : `${call}(${optionsTextOf(options)})`;
}

function isHashFormat(format: StringFormat): format is HashFormat {
  return hashFormat.test(format);
}

function optionsTextOf(options: Readonly<Record<string, unknown>>): string {
  const entries = Object.entries(options).map(([key, value]) => `${key}: ${optionTextOf(value)}`);
  return `{ ${entries.join(', ')} }`;
}

/** An option's value: a regex the Snapshot records as its source and flags, or its JSON. */
function optionTextOf(value: unknown): string {
  if (isRegex(value)) {
    return `new RegExp(${JSON.stringify(value.source)}, ${JSON.stringify(value.flags)})`;
  }
  return JSON.stringify(value);
}

/** A regex as the Snapshot records it. */
export type RegexText = { readonly source: string; readonly flags: string };

function isRegex(value: unknown): value is RegexText {
  return typeof value === 'object' && value !== null && 'source' in value && 'flags' in value;
}

/** A regex check, built from its source and flags so no escaping can change it. */
export function regexCallOf(regex: RegexText): string {
  return `.regex(new RegExp(${JSON.stringify(regex.source)}, ${JSON.stringify(regex.flags)}))`;
}
