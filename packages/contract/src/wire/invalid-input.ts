import type { StandardRejections } from '../declarations/index.ts';
import {
  type InputIn,
  type InputPart,
  type Issue,
  inOf,
  listedIssuesOf,
} from '../written/index.ts';
import { jsonBytesOf } from './body.ts';
import { rejectionResponseOf } from './responses.ts';

/** An Issue in a part of the request the Caller sent: the only kind the invalid-input body holds. */
export type InputIssue = Issue & { readonly part: InputPart };

/** An Issue as the invalid-input body lists it: with the part of the request it read. */
type ListedIssue = Omit<Issue, 'part'> & { readonly in: InputIn };

/** The body of the invalid-input Rejection, cf-loom's own, as the runtime writes it. */
export type InvalidInputBody = {
  readonly issues: readonly ListedIssue[];
  readonly omittedIssues: number;
};

/** The body of the invalid-input Rejection: the Issues `listedIssuesOf` lists, each with the part of the request it read. */
export function invalidInputBodyOf(issues: readonly InputIssue[]): InvalidInputBody {
  const { listed, omittedIssues } = listedIssuesOf(issues, listedOf, '['.length);
  return { issues: listed, omittedIssues };
}

/** An Issue as the body lists it, with the bytes of its JSON and the comma or closing bracket after it. */
function listedOf({ part, path, code, message }: InputIssue) {
  const issue = { in: inOf(part), path, code, message };
  return { written: issue, bytes: jsonBytesOf(issue).byteLength + 1 };
}

/** The response of the invalid-input Rejection: the Provider's code, status and message, cf-loom's body. */
export function invalidInputResponseOf(
  issues: readonly InputIssue[],
  standards: StandardRejections,
): Response {
  const { code, status, message } = standards.invalidInput;
  return rejectionResponseOf({ code, status, message, body: invalidInputBodyOf(issues) });
}
