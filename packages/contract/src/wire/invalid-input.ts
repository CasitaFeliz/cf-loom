import type * as core from 'zod/v4/core';
import {
  isStandardRejection,
  type ProvidedStandardRejections,
  type StandardRejections,
} from '../declarations/index.ts';
import {
  type AnswerableRejection,
  type InputIn,
  type InputPart,
  type Issue,
  inOf,
  schemaOf,
} from '../written/index.ts';
import { rejectionResponseOf } from './responses.ts';

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

/** The response of the invalid-input Rejection: the Provider's code, status and message, cf-loom's body. */
export function invalidInputResponseOf(
  issues: readonly InputIssue[],
  standards: StandardRejections,
): Response {
  const { code, status, message } = standards.invalidInput;
  return rejectionResponseOf({ code, status, message, body: invalidInputBodyOf(issues) });
}

/**
 * The schema a Rejection's body is read with: its declared one, or for invalid input the Reader the
 * Provider's Contract Package generated from its Snapshot.
 */
export function rejectionBodyReaderOf(
  rejection: AnswerableRejection,
  standards: ProvidedStandardRejections,
): core.$ZodType | undefined {
  if (!isStandardRejection(rejection)) {
    return schemaOf(rejection, 'body');
  }
  return rejection.name === 'invalidInput' ? standards.invalidInput.body : undefined;
}
