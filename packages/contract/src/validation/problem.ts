import { z } from 'zod';
import type { $ZodIssue } from 'zod/v4/core';
import type { Path } from '../walker/index.ts';
import { isAbsentAt } from '../written/index.ts';
import { locationOf } from './failures.ts';
import { issueWordsOf } from './issue-words.ts';

/** One place where a decoded value breaks what its definition promises, and what it breaks. */
export type Problem = { readonly at: Path; readonly reason: string };

/** A value read with a schema, or every place it breaks the schema, the first as zod found it. */
export type Read<Output> =
  | { readonly kind: 'read'; readonly value: Output }
  | { readonly kind: 'refused'; readonly problems: readonly [Problem, ...Problem[]] };

/** Absence is a fact about the input, so it is worded before any message a schema wrote. */
function problemOf(issue: $ZodIssue, input: unknown): Problem {
  const at: Path = issue.path.map((step) => (typeof step === 'symbol' ? String(step) : step));
  const reason = isAbsentAt(input, issue.path) ? 'is missing' : issue.message;
  if (issue.code === 'unrecognized_keys') {
    return { at: [...at, issue.keys[0] ?? ''], reason };
  }
  return { at, reason };
}

/**
 * Reads a value with a schema, worded for whoever `definer` names, such as `its format`: every
 * decoder of a document goes through it, so no reason prints zod's own wording, and a value that
 * is absent is missing, whatever the schema says of it.
 */
export function readWith<Schema extends z.core.$ZodType>(
  schema: Schema,
  input: unknown,
  definer: string,
): Read<z.output<Schema>> {
  const parsed = z.safeParse(schema, input, { error: issueWordsOf(definer) });
  if (parsed.success) {
    return { kind: 'read', value: parsed.data };
  }
  const [first, ...later] = parsed.error.issues.map((issue) => problemOf(issue, input));
  const unworded = { at: [], reason: `is not a value ${definer} defines` };
  return { kind: 'refused', problems: [first ?? unworded, ...later] };
}

/** A problem on one line, where it sits first, as every tool that reports a decoded value words it. */
export function problemLineOf(problem: Problem): string {
  return `${locationOf(problem.at)} ${problem.reason}`;
}
