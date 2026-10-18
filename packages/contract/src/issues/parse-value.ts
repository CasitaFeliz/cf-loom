import { z } from 'zod';
import type * as core from 'zod/v4/core';
import type { issueCodes } from '../declarations/index.ts';

/** What an issue says went wrong: a closed set cf-loom owns, never zod's codes. */
export type IssueCode = (typeof issueCodes)[number];

/** One way a value broke its schema, inside the value: never the received value itself. */
export type SchemaIssue = {
  readonly path: readonly (string | number)[];
  readonly code: IssueCode;
  readonly message: string;
};

/** A value parsed with its schema: the parsed value, unknown keys stripped, or every issue. */
export type Parsed<Value = unknown> =
  | { readonly kind: 'value'; readonly value: Value }
  | { readonly kind: 'issues'; readonly issues: readonly SchemaIssue[] };

/** Parses a value with its schema and turns zod's failures into cf-loom's issues. */
export function parseValue<Schema extends core.$ZodType>(
  schema: Schema,
  value: unknown,
): Parsed<core.output<Schema>> {
  const parsed = z.safeParse(schema, value, { reportInput: true });
  if (parsed.success) {
    return { kind: 'value', value: parsed.data };
  }
  return { kind: 'issues', issues: parsed.error.issues.flatMap(schemaIssuesOf) };
}

function schemaIssuesOf(issue: core.$ZodIssue): readonly SchemaIssue[] {
  const path = issue.path.map(pathKeyOf);
  if (issue.code === 'unrecognized_keys') {
    return issue.keys.map((key) => ({
      path: [...path, key],
      code: 'unrecognized_key',
      message: 'Unrecognized key',
    }));
  }
  return [{ path, code: issueCodeOf(issue), message: issue.message }];
}

/** A path key zod may hold as a symbol, which no Contract schema declares, spelled as text. */
function pathKeyOf(key: PropertyKey): string | number {
  return typeof key === 'symbol' ? String(key) : key;
}

/** A missing value is required whatever zod calls it; zod reports what it received as `input`. */
function issueCodeOf(issue: core.$ZodIssue): IssueCode {
  if (issue.input === undefined) {
    return 'required';
  }
  switch (issue.code) {
    case 'invalid_type':
    case 'too_small':
    case 'too_big':
    case 'invalid_format':
    case 'invalid_value':
      return issue.code;
    case 'not_multiple_of':
      return 'not_multiple';
    case 'unrecognized_keys':
      return 'unrecognized_key';
    case 'invalid_union':
    case 'invalid_key':
    case 'invalid_element':
    case 'custom':
      return 'invalid_value';
  }
}
