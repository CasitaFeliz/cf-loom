import { formatConstructorOf, type StringFormat } from '@cf-loom/contract/internal';
import { jsonLiteralOf, keyOf } from '../source-text/index.ts';

/**
 * The zod call that builds a format with the options the Snapshot records, so the generated
 * schema checks exactly what the author's did.
 */
export function formatCallOf(
  format: StringFormat,
  options: Readonly<Record<string, unknown>> | undefined,
): string {
  const call = formatConstructorOf(format);
  return options === undefined ? `${call}()` : `${call}(${optionsTextOf(options)})`;
}

function optionsTextOf(options: Readonly<Record<string, unknown>>): string {
  const entries = Object.entries(options).map(
    ([key, value]) => `${keyOf(key)}: ${optionTextOf(value)}`,
  );
  return `{ ${entries.join(', ')} }`;
}

/** An option's value: a regex the Snapshot records as its source and flags, or its JSON. */
function optionTextOf(value: unknown): string {
  return isRegex(value) ? regexTextOf(value) : jsonLiteralOf(value);
}

/** A regex as the Snapshot records it. */
export type RegexText = { readonly source: string; readonly flags: string };

function isRegex(value: unknown): value is RegexText {
  return typeof value === 'object' && value !== null && 'source' in value && 'flags' in value;
}

/** A regex check. */
export function regexCallOf(regex: RegexText): string {
  return `.regex(${regexTextOf(regex)})`;
}

/** A regex built from its source and flags, so no escaping can change it. */
function regexTextOf(regex: RegexText): string {
  return `new RegExp(${jsonLiteralOf(regex.source)}, ${jsonLiteralOf(regex.flags)})`;
}
