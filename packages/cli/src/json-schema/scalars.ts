import type { NumberNode, StringFormat, StringNode } from '@cf-loom/contract/internal';
import { definedOf, type JsonSchema } from './keywords.ts';

/** The flags that change nothing JSON Schema's `pattern` matches. */
const patternSafeFlags = /^[gdu]*$/;

/** A string with its lengths, its format and its regex as the matching keywords. */
export function stringSchemaOf(node: StringNode): JsonSchema {
  return definedOf({
    type: 'string',
    minLength: node.min,
    maxLength: node.max,
    format: formatOf(node),
    pattern: patternOf(node.regex),
  });
}

/** A number with its bounds and its step as the matching keywords. */
export function numberSchemaOf(node: NumberNode): JsonSchema {
  return definedOf({
    type: node.int === true ? 'integer' : 'number',
    minimum: node.min,
    maximum: node.max,
    exclusiveMinimum: node.exclusiveMin,
    exclusiveMaximum: node.exclusiveMax,
    multipleOf: node.multipleOf,
  });
}

/** The formats JSON Schema defines otherwise than zod does, so a document that names them would be stricter. */
const unwrittenFormats: ReadonlySet<StringFormat> = new Set<StringFormat>([
  'time',
  'duration',
  'email',
]);

/**
 * A string's `format`: `date-time` where its values are zod's, none for a format JSON Schema defines
 * otherwise, else its own name, an annotation in 2020-12.
 */
function formatOf({ format, formatOptions }: StringNode): string | undefined {
  if (format === undefined || unwrittenFormats.has(format)) {
    return undefined;
  }
  if (format === 'datetime') {
    return isDateTimeOfRfc3339(formatOptions) ? 'date-time' : format;
  }
  return format;
}

/** Whether a datetime admits only instants JSON Schema's `date-time` admits: not local, not minute-precise. */
function isDateTimeOfRfc3339(options: StringNode['formatOptions']): boolean {
  return options?.['local'] !== true && options?.['precision'] !== -1;
}

/** The regex's source, when its flags leave a JSON Schema `pattern` matching what the regex does. */
function patternOf(regex: StringNode['regex']): string | undefined {
  return regex !== undefined && patternSafeFlags.test(regex.flags) ? regex.source : undefined;
}
