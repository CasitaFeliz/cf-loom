import { z } from 'zod';
import { canonicalJson } from './canonical-json.ts';
import type { BuiltDef, DeclaredCheck } from './check-defs.ts';

/** The options of a format zod builds, or a pattern of the author's in place of zod's. */
export type FormatOptions =
  | { readonly kind: 'options'; readonly declared: Readonly<Record<string, unknown>> }
  | { readonly kind: 'custom-pattern' };

type Option = [string, unknown];

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
  const keys = optionKeysByFormat.get(String(def.format)) ?? [];
  const declared = keys.map((key): Option => [key, def[key]]).filter(isDeclared);
  const reference = check.rebuilt({ ...baseOf(def), ...Object.fromEntries(declared) });
  const defaults = check.rebuilt(baseOf(def));
  if (reference === undefined || defaults === undefined) {
    return undefined;
  }
  if (!samePattern(def.pattern, reference.pattern)) {
    return { kind: 'custom-pattern' };
  }
  const format: DeclaredFormat = { check, declared, reference, defaults };
  const options = declared.filter((option) => isNonDefault(option, format)).map(jsonOption);
  return { kind: 'options', declared: Object.fromEntries(options) };
}

/**
 * Whether an option changes the format: it differs from zod's default value, and dropping it
 * changes the pattern zod builds, when zod builds one.
 */
function isNonDefault(option: Option, format: DeclaredFormat): boolean {
  const [key] = option;
  const { check, declared, reference } = format;
  if (
    canonicalJson(jsonOption(option)) === canonicalJson(jsonOption([key, defaultOf(key, format)]))
  ) {
    return false;
  }
  if (reference.pattern === undefined) {
    return true;
  }
  const others = declared.filter(([name]) => name !== key);
  const def = check.def as unknown as BuiltDef;
  const withoutOption = check.rebuilt({ ...baseOf(def), ...Object.fromEntries(others) });
  return !samePattern(reference.pattern, withoutOption?.pattern);
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

function samePattern(left: unknown, right: unknown): boolean {
  const leftPattern = left instanceof RegExp ? left : undefined;
  const rightPattern = right instanceof RegExp ? right : undefined;
  return leftPattern?.source === rightPattern?.source && leftPattern?.flags === rightPattern?.flags;
}

function isDeclared([, value]: Option): boolean {
  return value !== undefined;
}

function jsonOption([key, value]: Option): Option {
  if (value instanceof RegExp) {
    return [key, { source: value.source, flags: value.flags }];
  }
  return [key, value];
}
