import { z } from 'zod';
import type * as core from 'zod/v4/core';
import type { IssueCode } from '../declarations/index.ts';
import { withinStack } from '../walker/index.ts';
import { isAbsentAt } from '../written/index.ts';

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

/**
 * What a value nested past the stack is: one issue at its root, since no Reader can read it, and the
 * stack's bound is no number cf-loom chooses.
 */
const nestedTooDeeply: SchemaIssue = {
  path: [],
  code: 'malformed',
  message: 'The value is nested too deeply to read',
};

/**
 * Parses a value with its schema and turns zod's failures into cf-loom's issues; a value nested
 * past the stack is one `malformed` issue at its root, so a received value never makes a reader
 * throw.
 */
export function parseValue<Schema extends core.$ZodType>(
  schema: Schema,
  value: unknown,
): Parsed<core.output<Schema>> {
  return parsedOf(() => z.safeParse(schema, value), value);
}

/**
 * A value written as its schema's readers read it, encoded back through the schema: its
 * constraints checked, unknown keys stripped and an Unknown case turned into its text.
 */
export function encodedValueOf(schema: core.$ZodType, value: unknown): Parsed {
  return parsedOf(() => z.safeEncode(schema, value), value);
}

function parsedOf<Value>(run: () => z.ZodSafeParseResult<Value>, value: unknown): Parsed<Value> {
  const result = withinStack(run);
  if (result === undefined) {
    return { kind: 'issues', issues: [nestedTooDeeply] };
  }
  if (result.success) {
    return { kind: 'value', value: result.data };
  }
  const issues = result.error.issues.flatMap((issue) => schemaIssuesOf(issue, value));
  return { kind: 'issues', issues };
}

function schemaIssuesOf(issue: core.$ZodIssue, value: unknown): readonly SchemaIssue[] {
  const path = issue.path.map(pathKeyOf);
  if (issue.code === 'unrecognized_keys') {
    return issue.keys.map((key) => ({
      path: [...path, key],
      code: 'unrecognized_key',
      message: 'Unrecognized key',
    }));
  }
  const code = isAbsentAt(value, issue.path) ? 'required' : issueCodeOf(issue);
  return [{ path, code, message: issue.message }];
}

/** A path key zod may hold as a symbol, which no Contract schema declares, spelled as text. */
function pathKeyOf(key: PropertyKey): string | number {
  return typeof key === 'symbol' ? String(key) : key;
}

function issueCodeOf(issue: core.$ZodIssue): IssueCode {
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
