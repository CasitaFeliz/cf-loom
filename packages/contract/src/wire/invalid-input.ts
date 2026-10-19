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
