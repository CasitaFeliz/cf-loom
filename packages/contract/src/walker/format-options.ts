import { z } from 'zod';
import { canonicalJson } from './canonical-json.ts';
import type { BuiltDef, DeclaredCheck } from './check-defs.ts';
import type { Regex } from './nodes.ts';
import { plainRegexOf } from './plain-regexes.ts';

/**
 * The options of a format zod builds, a pattern of the author's in place of zod's, or a regex the
 * def holds that is no plain RegExp.
 */
export type FormatOptions =
  | { readonly kind: 'options'; readonly declared: Readonly<Record<string, unknown>> }
  | { readonly kind: 'custom-pattern' }
  | { readonly kind: 'regex-not-plain' };

type Option = [string, unknown];

/** The regexes a format's def holds, each judged: its pattern, and its options with a regex as data. */
type JudgedRegexes = { readonly pattern: Regex | undefined; readonly declared: readonly Option[] };

/** A format as declared, the same format zod builds for those options, and zod's defaults. */
type DeclaredFormat = {
  readonly check: DeclaredCheck;
  readonly declared: readonly Option[];
  readonly reference: BuiltDef;
  readonly defaults: BuiltDef;
};

const regexOption = z.strictObject({ source: z.string(), flags: z.string() });

/** The value each format option takes as a Snapshot holds it, a regex as its source and flags. */
const formatOptionValues = {
  version: z.string(),
  alg: z.string(),
  delimiter: z.string(),
  offset: z.boolean(),
  local: z.boolean(),
  normalize: z.boolean(),
  precision: z.int(),
  protocol: regexOption,
  hostname: regexOption,
} as const;

/** An option a format's constructor reads. */
type FormatOptionKey = keyof typeof formatOptionValues;

/** The options each format's constructor reads; any other key changes nothing zod checks. */
const optionKeysByFormat: ReadonlyMap<string, readonly FormatOptionKey[]> = new Map<
  string,
  readonly FormatOptionKey[]
>([
  ['uuid', ['version']],
  ['url', ['protocol', 'hostname', 'normalize']],
  ['datetime', ['offset', 'local', 'precision']],
  ['time', ['precision']],
  ['ipv4', ['version']],
  ['ipv6', ['version']],
  ['mac', ['delimiter']],
  ['jwt', ['alg']],
]);

/**
 * The options a Snapshot may carry for a string format: those its constructor reads, `normalize`
 * aside, which `generate` refuses.
 */
export function formatOptionKeysOf(format: string | undefined): readonly string[] {
  const keys = format === undefined ? undefined : optionKeysByFormat.get(format);
  return (keys ?? []).filter((key) => key !== 'normalize');
}

/** Whether a value is one a format option takes, as the walker writes it into a Snapshot. */
export function isFormatOptionValue(option: string, value: unknown): boolean {
  return isFormatOptionKey(option) && formatOptionValues[option].safeParse(value).success;
}

function isFormatOptionKey(option: string): option is FormatOptionKey {
  return Object.hasOwn(formatOptionValues, option);
}

/**
 * The options a format declares that differ from zod's default, read against the format the
 * author's own zod builds for them; nothing when that zod refuses them.
 */
export function formatOptionsOf(check: DeclaredCheck): FormatOptions | undefined {
  const def = check.def as unknown as BuiltDef;
  const regexes = judgedRegexesOf(def);
  if (regexes === undefined) {
    return { kind: 'regex-not-plain' };
  }
  const { pattern, declared } = regexes;
  const reference = check.rebuilt({ ...baseOf(def), ...Object.fromEntries(declared) });
  const defaults = check.rebuilt(baseOf(def));
  if (reference === undefined || defaults === undefined) {
    return undefined;
  }
  if (!samePattern(pattern, plainRegexOf(reference.pattern))) {
    return { kind: 'custom-pattern' };
  }
  const format: DeclaredFormat = { check, declared, reference, defaults };
  const options = declared.filter((option) => isNonDefault(option, format));
  return { kind: 'options', declared: Object.fromEntries(options) };
}

/**
 * Every regex a format's def holds, judged before anything of it is read; none when one is no
 * plain RegExp, since zod tests a value through that regex's own `test`.
 */
function judgedRegexesOf(def: BuiltDef): JudgedRegexes | undefined {
  const keys = optionKeysByFormat.get(String(def.format)) ?? [];
  const options = keys.map((key): Option => [key, def[key]]).filter(isDeclared);
  const declared = options.map(judgedOption);
  const pattern = plainRegexOf(def.pattern);
  if ((def.pattern !== undefined && pattern === undefined) || !declared.every(isDeclared)) {
    return undefined;
  }
  return { pattern, declared };
}

/** An option as a Snapshot holds it: a regex as its source and flags, nothing when it is no plain RegExp. */
function judgedOption([key, value]: Option): Option {
  return isRegexOption(key) ? [key, plainRegexOf(value)] : [key, value];
}

function isRegexOption(key: string): boolean {
  return isFormatOptionKey(key) && formatOptionValues[key] === regexOption;
}

/**
 * Whether an option changes the format: it differs from zod's default value, and dropping it
 * changes the pattern zod builds, when zod builds one.
 */
function isNonDefault(option: Option, format: DeclaredFormat): boolean {
  const [key] = option;
  const { check, declared, reference } = format;
  if (canonicalJson(option) === canonicalJson([key, defaultOf(key, format)])) {
    return false;
  }
  if (reference.pattern === undefined) {
    return true;
  }
  const others = declared.filter(([name]) => name !== key);
  const def = check.def as unknown as BuiltDef;
  const withoutOption = check.rebuilt({ ...baseOf(def), ...Object.fromEntries(others) });
  return !samePattern(plainRegexOf(reference.pattern), plainRegexOf(withoutOption?.pattern));
}

/** zod's default for an option; zod reads a boolean option left out as `false`. */
function defaultOf(key: string, format: DeclaredFormat): unknown {
  const declared = format.declared.find(([name]) => name === key)?.[1];
  const zodDefault = format.defaults[key];
  return zodDefault === undefined && typeof declared === 'boolean' ? false : zodDefault;
}

function baseOf(def: BuiltDef): BuiltDef {
  return { type: 'string', check: 'string_format', format: def.format };
}

function samePattern(left: Regex | undefined, right: Regex | undefined): boolean {
  return left?.source === right?.source && left?.flags === right?.flags;
}

function isDeclared([, value]: Option): boolean {
  return value !== undefined;
}
