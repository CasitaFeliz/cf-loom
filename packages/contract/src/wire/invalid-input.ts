import type { StandardRejections } from '../declarations/index.ts';
import { type InputIn, type InputPart, type Issue, inOf } from '../written/index.ts';
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

/** The most Issues the invalid-input body lists, so a Response stays small whatever the request. */
const listedIssueLimit = 100;

/** The most bytes the invalid-input body's `issues` take, as UTF-8 JSON text, since a path holds the Caller's keys. */
const listedIssueBytes = 65_536;

/**
 * The body of the invalid-input Rejection: the Issues in the order they were read, each with the
 * part of the request it read, up to the first that would pass `listedIssueLimit` Issues or
 * `listedIssueBytes` of JSON; that one and every later one counted in `omittedIssues`.
 */
export function invalidInputBodyOf(issues: readonly InputIssue[]): InvalidInputBody {
  const listed: ListedIssue[] = [];
  let bytes = '['.length;
  for (const { part, path, code, message } of issues) {
    if (listed.length === listedIssueLimit) break;
    const issue = { in: inOf(part), path, code, message };
    const total = bytes + jsonBytesOf(issue).byteLength + 1;
    if (total > listedIssueBytes) break;
    listed.push(issue);
    bytes = total;
  }
  return { issues: listed, omittedIssues: issues.length - listed.length };
}

/** The response of the invalid-input Rejection: the Provider's code, status and message, cf-loom's body. */
export function invalidInputResponseOf(
  issues: readonly InputIssue[],
  standards: StandardRejections,
): Response {
  const { code, status, message } = standards.invalidInput;
  return rejectionResponseOf({ code, status, message, body: invalidInputBodyOf(issues) });
}
