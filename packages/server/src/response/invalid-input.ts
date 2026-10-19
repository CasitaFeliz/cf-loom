import type { StandardRejections } from '@casitafeliz/loom-contract';
import { type InputIssue, invalidInputBodyOf } from '@casitafeliz/loom-contract/internal';
import { rejectionResponseOf } from './outcome.ts';

/**
 * The invalid-input Rejection, the one place it is built: the root's code, status and message,
 * and cf-loom's body of Issues, whether the run or the reading of the request found them.
 */
export function invalidInputResponseOf(
  issues: readonly InputIssue[],
  standards: StandardRejections,
): Response {
  const { code, status, message } = standards.invalidInput;
  return rejectionResponseOf({ code, status, message, body: invalidInputBodyOf(issues) });
}
