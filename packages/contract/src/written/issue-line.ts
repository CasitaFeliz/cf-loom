import { dottedPathOf, unbrokenLineOf } from '../lines/index.ts';
import { listedIssuesOf } from './listed-issues.ts';
import type { Issue } from './parts.ts';

/** One Issue as a line of an error or a log, after what it came from: where it sits and what broke, never the received value. */
export function issueLineOf(source: string, { part, path, code, message }: Issue): string {
  const location = path.length === 0 ? part : `${part}.${dottedPathOf(path)}`;
  return `${source}: ${location} ${code}: ${message}`;
}

/**
 * The Issues of one Fault as the console writes them: the first ones within the count and size the
 * invalid-input body lists, one line each as `issueLineOf` writes it, then a line counting the
 * others when any is left out.
 */
export function listedIssueLinesOf(source: string, issues: readonly Issue[]): readonly string[] {
  const { listed, omittedIssues } = listedIssuesOf(issues, (issue) => lineOf(source, issue), 0);
  if (omittedIssues === 0) {
    return listed;
  }
  const noun = omittedIssues === 1 ? 'Issue' : 'Issues';
  return [...listed, unbrokenLineOf(`${source}: ${omittedIssues} more ${noun}`)];
}

/** An Issue's line on one line, with the bytes the console writes for it: its UTF-8 and a line break. */
function lineOf(source: string, issue: Issue) {
  const line = unbrokenLineOf(issueLineOf(source, issue));
  return { written: line, bytes: new TextEncoder().encode(line).byteLength + 1 };
}
