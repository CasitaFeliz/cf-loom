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

/** One side of a number's bounds: the inclusive one and the exclusive one, each when declared. */
type Side = { readonly inclusive: number | undefined; readonly exclusive: number | undefined };

/** The end of the safe integers on one side, and which of two bounds on that side is the tighter. */
type SafeEnd = {
  readonly limit: number;
  readonly tighter: (bound: number, other: number) => number;
};

const lowestSafe: SafeEnd = { limit: Number.MIN_SAFE_INTEGER, tighter: Math.max };
const highestSafe: SafeEnd = { limit: Number.MAX_SAFE_INTEGER, tighter: Math.min };

/**
 * A number with its bounds and its step as the matching keywords; an int is a safe integer, as zod's
 * `z.int()` checks, so its bounds are cut to the safe integers.
 */
export function numberSchemaOf(node: NumberNode): JsonSchema {
  const lower = lowerOf(node);
  const upper = upperOf(node);
  return definedOf({
    type: node.int === true ? 'integer' : 'number',
    minimum: lower.inclusive,
    maximum: upper.inclusive,
    exclusiveMinimum: lower.exclusive,
    exclusiveMaximum: upper.exclusive,
    multipleOf: node.multipleOf,
  });
}

function lowerOf(node: NumberNode): Side {
  const declared = { inclusive: node.min, exclusive: node.exclusiveMin };
  return node.int === true ? cutToSafe(declared, lowestSafe) : declared;
}

function upperOf(node: NumberNode): Side {
  const declared = { inclusive: node.max, exclusive: node.exclusiveMax };
  return node.int === true ? cutToSafe(declared, highestSafe) : declared;
}

/**
 * The tighter of a side's bounds and the end of the safe integers: an exclusive bound beyond the end
 * gives way to it, and one inside it stands in for it.
 */
function cutToSafe({ inclusive, exclusive }: Side, { limit, tighter }: SafeEnd): Side {
  const exclusiveStands = exclusive !== undefined && tighter(exclusive, limit) === exclusive;
  const kept = exclusiveStands ? exclusive : undefined;
  if (inclusive !== undefined) {
    return { inclusive: tighter(inclusive, limit), exclusive: kept };
  }
  return { inclusive: exclusiveStands ? undefined : limit, exclusive: kept };
}

/** The formats JSON Schema defines otherwise than zod does, so a document that names them would be stricter. */
const unwrittenFormats: ReadonlySet<StringFormat> = new Set<StringFormat>([
  'time',
  'duration',
  'email',
]);

/**
 * A string's `format`: `date-time` where its values are zod's, none for a format JSON Schema defines
 * otherwise, else its own name, an annotation where the dialect does not define it.
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
