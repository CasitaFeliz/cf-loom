import type { $ZodIssue } from 'zod/v4/core';
import type { Path } from '../walker/index.ts';

/** One place where a decoded value breaks what its definition promises, and what it breaks. */
export type Problem = { readonly at: Path; readonly reason: string };

/** The first of a zod failure's issues as one place and one reason, worded for whoever `definer` names, `its format`. */
export function problemOf(issues: readonly $ZodIssue[], definer: string): Problem {
  const [issue] = issues;
  if (issue === undefined) {
    return { at: [], reason: `is not a value ${definer} defines` };
  }
  const at: Path = issue.path.map((step) => (typeof step === 'symbol' ? String(step) : step));
  if (issue.code === 'unrecognized_keys') {
    return { at: [...at, issue.keys[0] ?? ''], reason: `is a key ${definer} does not define` };
  }
  if (issue.code === 'invalid_union') {
    const reason =
      issue.errors.length === 0
        ? `is not a value ${definer} defines`
        : `matches none of the forms ${definer} defines`;
    return { at, reason };
  }
  return { at, reason: issue.message };
}
