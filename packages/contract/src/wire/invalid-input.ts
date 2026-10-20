import { z } from 'zod';
import type * as core from 'zod/v4/core';
import {
  inputIns,
  isStandardRejection,
  issueCodes,
  type StandardRejections,
} from '../declarations/index.ts';
import { openEnumReader } from '../open/index.ts';
import {
  type AnswerableRejection,
  type InputIn,
  type InputPart,
  type Issue,
  inOf,
  schemaOf,
} from '../written/index.ts';
import { rejectionResponseOf, type SentRejection } from './responses.ts';

/** An Issue in a part of the request the Caller sent: the only kind the invalid-input body holds. */
export type InputIssue = Issue & { readonly part: InputPart };

/** The body of the invalid-input Rejection, cf-loom's own, as the runtime writes it. */
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

/** The invalid-input Rejection: the Provider's code, status and message, with cf-loom's body of the Issues. */
export function invalidInputRejectionOf(
  issues: readonly InputIssue[],
  standards: StandardRejections,
): SentRejection {
  return { ...standards.invalidInput, body: invalidInputBodyOf(issues) };
}

/** The response of the invalid-input Rejection: the Provider's code, status and message, cf-loom's body. */
export function invalidInputResponseOf(
  issues: readonly InputIssue[],
  standards: StandardRejections,
): Response {
  return rejectionResponseOf(invalidInputRejectionOf(issues, standards));
}

/**
 * The invalid-input body as a Caller reads it: its `in` and `code` as Open Enums, so an issue code
 * or part a later cf-loom adds reaches an older client as its Unknown case.
 */
export const invalidInputBodyReader = z.object({
  issues: z.array(
    z.object({
      in: openEnumReader(inputIns),
      path: z.array(z.union([z.string(), z.number()])),
      code: openEnumReader(issueCodes),
      message: z.string(),
    }),
  ),
});

/** The invalid-input body as a Caller receives it, a part or code it does not know as `{ unknown }`. */
export type ReceivedInvalidInputBody = z.output<typeof invalidInputBodyReader>;

/** The schema a Rejection's body is read with: cf-loom's reader for invalid input, else its declared one. */
export function rejectionBodyReaderOf(rejection: AnswerableRejection): core.$ZodType | undefined {
  if (!isStandardRejection(rejection)) {
    return schemaOf(rejection, 'body');
  }
  return rejection.name === 'invalidInput' ? invalidInputBodyReader : undefined;
}
