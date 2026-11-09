import { inspect, types } from 'node:util';
import { joinedOf, kindWordsOf } from '@cf-loom/contract/internal';
import { z } from 'zod';

/** What a refusal shows of a list: its first entries and its nesting, which the copy and `inspect` both read. */
const shown = { depth: 2, maxArrayLength: 100 } as const;

/** A value with no text of its own, which `inspect` prints as the words of its kind. */
function worded(words: string): object {
  return { [inspect.custom]: () => words };
}

/**
 * The part of a value a refusal shows, copied by reading it through `kindWordsOf`, `types.isProxy`
 * and own data properties only, so that `inspect` of the copy runs none of the value's code: what
 * has text of its own and lists held as data stay, anything else is worded.
 */
function shownCopyOf(value: unknown, depth: number): unknown {
  const words = kindWordsOf(value);
  if (words === undefined) {
    return value;
  }
  if (types.isProxy(value) || !Array.isArray(value)) {
    return worded(words);
  }
  if (depth > shown.depth) {
    return value.length === 0 ? [] : [0];
  }
  const held: unknown[] = [];
  for (let at = 0; at < Math.min(value.length, shown.maxArrayLength); at++) {
    const own = Object.getOwnPropertyDescriptor(value, at);
    if (own === undefined || !('value' in own)) {
      return worded(words);
    }
    held.push(shownCopyOf(own.value, depth + 1));
  }
  held.length = value.length;
  return held;
}

/**
 * A refused value as a refusal shows it, as far as a setting's type lets it be one and running none
 * of its code: a string, number, boolean, `null` or `undefined` as `util.inspect` prints it
 * (`'7 days'`, `0`), a list held as data with its first 100 entries, three levels of nesting
 * (`[ '30s', '0s' ]`), anything else in the words of its kind (`an object`, `a list`, `a function`,
 * `a symbol`, `a bigint`).
 */
export function oneLineOf(value: unknown): string {
  return inspect(shownCopyOf(value, 0), { ...shown, breakLength: Infinity, compact: true });
}

/** A setting read by `read`, which answers undefined for what it refuses, as an issue that shows the value on one line: `<value> is not <expected>`. */
export function readAs<Value>(
  expected: string,
  read: (input: unknown) => Value | undefined,
): z.ZodType<Value> {
  return z.unknown().transform((input, context) => {
    const value = read(input);
    if (value === undefined) {
      const message = `${oneLineOf(input)} is not ${expected}`;
      context.issues.push({ code: 'custom', message, input });
      return z.NEVER;
    }
    return value;
  });
}

/** One of `choices`, refused as `one of a, b or c`. */
export function choice<const Choice extends string>(choices: readonly Choice[]): z.ZodType<Choice> {
  const expected = `one of ${joinedOf(choices, 'or')}`;
  return readAs(expected, (input) => choices.find((candidate) => candidate === input));
}

/** A whole number from 1, a safe integer. */
export function countOf(input: unknown): number | undefined {
  return typeof input === 'number' && Number.isSafeInteger(input) && input >= 1 ? input : undefined;
}

/** A whole number from 1, or `'unlimited'` read as `-1`. */
export const unlimitedCount = readAs("a whole number from 1, or 'unlimited'", (input) =>
  input === 'unlimited' ? -1 : countOf(input),
);

function isRead<Value>(value: Value | undefined): value is Value {
  return value !== undefined;
}

/** One value or a non-empty list, every value read by `read`, as a list; `undefined` when any is refused. */
export function oneOrListOf<Value>(
  read: (input: unknown) => Value | undefined,
): (input: unknown) => readonly [Value, ...Value[]] | undefined {
  return (input) => {
    const values = (Array.isArray(input) ? input : [input]).map(read);
    const [first, ...later] = values.filter(isRead);
    const isEveryValueRead = first !== undefined && later.length + 1 === values.length;
    return isEveryValueRead ? [first, ...later] : undefined;
  };
}
