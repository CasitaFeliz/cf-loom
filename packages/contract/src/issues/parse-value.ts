import { z } from 'zod';
import type * as core from 'zod/v4/core';
import type { IssueCode } from '../declarations/index.ts';

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
  const parsed = z.safeParse(schema, value);
  if (parsed.success) {
    return { kind: 'value', value: parsed.data };
  }
  const issues = parsed.error.issues.flatMap((issue) => schemaIssuesOf(issue, value));
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
  const code = isMissingAt(value, issue.path) ? 'required' : issueCodeOf(issue);
  return [{ path, code, message: issue.message }];
}

/** A path key zod may hold as a symbol, which no Contract schema declares, spelled as text. */
function pathKeyOf(key: PropertyKey): string | number {
  return typeof key === 'symbol' ? String(key) : key;
}

/**
 * Whether what an issue points at is missing, whatever zod calls it: the value itself, or a key its
 * parent object lacks; a present `undefined`, or one inside a list, is a value of the wrong type.
 */
function isMissingAt(value: unknown, path: readonly PropertyKey[]): boolean {
  const key = path.at(-1);
  if (key === undefined) {
    return value === undefined;
  }
  const parent = valueAt(value, path.slice(0, -1));
  return isKeyed(parent) && !(key in parent);
}

function valueAt(value: unknown, path: readonly PropertyKey[]): unknown {
  let current = value;
  for (const key of path) {
    current =
      typeof current === 'object' && current !== null ? Reflect.get(current, key) : undefined;
  }
  return current;
}

/** An object whose fields are keys, a class instance included; never a list. */
function isKeyed(value: unknown): value is object {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
