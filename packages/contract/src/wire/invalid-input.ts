import { z } from 'zod';
import { inputIns, issueCodes } from '../declarations/index.ts';
import { type InputIn, type InputPart, type Issue, inOf } from '../validation/index.ts';

/** An Issue in a part of the request the Caller sent: the only kind the invalid-input body holds. */
export type InputIssue = Issue & { readonly part: InputPart };

/** The body of the invalid-input Rejection, cf-loom's own, as it travels and as the client decodes it. */
export type InvalidInputBody = {
  readonly issues: readonly (Omit<Issue, 'part'> & { readonly in: InputIn })[];
};

/** The body of the invalid-input Rejection: each Issue with the part of the request it read. */
export function invalidInputBodyOf(issues: readonly InputIssue[]): InvalidInputBody {
  return {
    issues: issues.map(({ part, path, code, message }) => ({
      in: inOf(part),
      path,
      code,
      message,
    })),
  };
}

/** An Open Enum's reader: a value it does not know arrives as its Unknown case, `{ unknown }`. */
function openEnumReaderOf<const Values extends readonly [string, ...string[]]>(values: Values) {
  return z.union([z.enum(values), z.string().transform((unknown) => ({ unknown }))]);
}

/**
 * The invalid-input body as a Caller reads it: its `in` and `code` as Open Enums, so an issue code
 * or part a later cf-loom adds reaches an older client as its Unknown case.
 */
export const invalidInputBodyReader = z.object({
  issues: z.array(
    z.object({
      in: openEnumReaderOf(inputIns),
      path: z.array(z.union([z.string(), z.number()])),
      code: openEnumReaderOf(issueCodes),
      message: z.string(),
    }),
  ),
});

/** The invalid-input body as a Caller receives it, a part or code it does not know as `{ unknown }`. */
export type ReceivedInvalidInputBody = z.output<typeof invalidInputBodyReader>;
