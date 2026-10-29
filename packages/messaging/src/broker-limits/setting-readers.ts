import { inspect } from 'node:util';
import { z } from 'zod';

/** A setting read by `read`, which answers undefined for what it refuses, as an issue that shows the value: `<value> is not <expected>`. */
export function readAs<Value>(
  expected: string,
  read: (input: unknown) => Value | undefined,
): z.ZodType<Value> {
  return z.unknown().transform((input, context) => {
    const value = read(input);
    if (value === undefined) {
      const message = `${inspect(input, { breakLength: Infinity })} is not ${expected}`;
      context.issues.push({ code: 'custom', message, input });
      return z.NEVER;
    }
    return value;
  });
}

/** One of `choices`, refused as `one of a, b or c`. */
export function choice<const Choice extends string>(choices: readonly Choice[]): z.ZodType<Choice> {
  const expected = `one of ${choices.slice(0, -1).join(', ')} or ${choices.at(-1)}`;
  return readAs(expected, (input) => choices.find((candidate) => candidate === input));
}

/** A whole number from 1, a safe integer. */
export function countOf(input: unknown): number | undefined {
  return typeof input === 'number' && Number.isSafeInteger(input) && input >= 1 ? input : undefined;
}

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
