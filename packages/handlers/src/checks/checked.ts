import type { IssueCode, Part, SchemaIssue } from '@casitafeliz/loom-contract/internal';
import { parseValue } from '@casitafeliz/loom-contract/internal';
import type * as core from 'zod/v4/core';

/** Where in a value an Issue sits, inside its part. */
type Path = readonly (string | number)[];

/** The slot an Issue sits in: a part of an Endpoint, a Guard or a Rejection, or the Rejections. */
type IssuePart = Exclude<Part, 'schema'> | 'rejections';

/** One way a value broke its schema: the part and path, cf-loom's code and a message; never the value. */
export type Issue = {
  readonly part: IssuePart;
  readonly path: Path;
  readonly code: IssueCode;
  readonly message: string;
};

/** A value checked against the Contract: parsed, or every Issue it broke. */
export type Checked<Value> =
  | { readonly kind: 'value'; readonly value: Value }
  | { readonly kind: 'issues'; readonly issues: readonly Issue[] };

/**
 * A value checked against the schema its part declares, its Issues at `at` inside the part; where
 * the part declares no schema, the value must be missing.
 */
export function checkedPart<Schema extends core.$ZodType>(
  part: Exclude<Part, 'schema'>,
  schema: Schema | undefined,
  given: { readonly value: unknown; readonly at?: Path },
): Checked<core.output<Schema> | undefined> {
  const at = given.at ?? [];
  if (schema === undefined) {
    return given.value === undefined
      ? { kind: 'value', value: undefined }
      : {
          kind: 'issues',
          issues: [{ part, path: at, code: 'invalid_type', message: 'Expected no value' }],
        };
  }
  const parsed = parseValue(schema, given.value);
  if (parsed.kind === 'value') {
    return parsed;
  }
  return { kind: 'issues', issues: parsed.issues.map((issue) => issueAt(part, at, issue)) };
}

/** Several checks as one: every value by its name, or the Issues of all of them. */
export function checkedAll<Values extends Readonly<Record<string, unknown>>>(
  checks: {
    readonly [Name in keyof Values]: Checked<Values[Name]>;
  },
): Checked<Values> {
  const all: readonly Checked<unknown>[] = Object.values(checks);
  const issues = all.filter(isIssues).flatMap((check) => check.issues);
  if (issues.length > 0) {
    return { kind: 'issues', issues };
  }
  const entries = Object.entries(checks).map(([name, check]) => [name, checkedValueOf(check)]);
  return { kind: 'value', value: Object.fromEntries(entries) as Values };
}

/** A check with more Issues found beside it. */
export function withIssues<Value>(
  checked: Checked<Value>,
  found: readonly Issue[],
): Checked<Value> {
  if (found.length === 0) {
    return checked;
  }
  const earlier = checked.kind === 'issues' ? checked.issues : [];
  return { kind: 'issues', issues: [...earlier, ...found] };
}

/** What a check's value becomes, its Issues kept as they are. */
export function mapValue<Value, Mapped>(
  checked: Checked<Value>,
  map: (value: Value) => Mapped,
): Checked<Mapped> {
  return checked.kind === 'issues' ? checked : { kind: 'value', value: map(checked.value) };
}

/** A field of what a call was given, whatever it was given. */
export function fieldOf(given: unknown, key: string): unknown {
  if (typeof given !== 'object' || given === null) {
    return undefined;
  }
  return Reflect.get(given, key);
}

function isIssues(check: Checked<unknown>): check is Extract<Checked<unknown>, { kind: 'issues' }> {
  return check.kind === 'issues';
}

function checkedValueOf(check: Checked<unknown>): unknown {
  return check.kind === 'value' ? check.value : undefined;
}

function issueAt(part: IssuePart, at: Path, issue: SchemaIssue): Issue {
  return { part, ...issue, path: [...at, ...issue.path] };
}
