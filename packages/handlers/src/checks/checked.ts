import type { IssueCode, Part, SchemaIssue } from '@casitafeliz/loom-contract/internal';
import { parseValue } from '@casitafeliz/loom-contract/internal';
import type * as core from 'zod/v4/core';

/** Where in a value an Issue sits, inside its part. */
type Path = readonly (string | number)[];

/** One way a value broke its schema: the part and path, cf-loom's code and a message; never the value. */
export type Issue = {
  readonly part: Part | 'rejections';
  readonly path: Path;
  readonly code: IssueCode;
  readonly message: string;
};

/** A value checked against the Contract: parsed, or every Issue it broke. */
export type Checked<Value> =
  | { readonly kind: 'value'; readonly value: Value }
  | { readonly kind: 'issues'; readonly issues: readonly Issue[] };

/** One value to parse with its schema, under a key of the parsed object, at a path of its part. */
export type Slot = {
  readonly key: string;
  readonly part: Part;
  readonly at: Path;
  readonly schema: core.$ZodType;
  readonly value: unknown;
};

/** Parses each slot, keeping the parsed values by key, or every Issue of every slot. */
export function checkedSlots(slots: readonly Slot[]): Checked<Readonly<Record<string, unknown>>> {
  const issues: Issue[] = [];
  const entries: [string, unknown][] = [];
  for (const slot of slots) {
    const parsed = parseValue(slot.schema, slot.value);
    if (parsed.kind === 'issues') {
      issues.push(...parsed.issues.map((issue) => issueAt(slot, issue)));
    } else {
      entries.push([slot.key, parsed.value]);
    }
  }
  if (issues.length > 0) {
    return { kind: 'issues', issues };
  }
  return { kind: 'value', value: Object.fromEntries(entries) };
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

/** What a part holds where its declaration allows nothing. */
export function noValueIssue(part: Part): Issue {
  return { part, path: [], code: 'invalid_type', message: 'Expected no value' };
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

function issueAt(slot: Slot, issue: SchemaIssue): Issue {
  return { part: slot.part, ...issue, path: [...slot.at, ...issue.path] };
}
