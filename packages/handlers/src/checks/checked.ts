import type { Issue } from '@cf-loom/contract';
import type { Checked } from '@cf-loom/contract/internal';

/** One way a value broke its part of the Contract, as contract defines it for every package. */
export type { Issue } from '@cf-loom/contract';

/** A value checked against the Contract, part by part: parsed, or every Issue it broke; the contract's. */
export type { Checked } from '@cf-loom/contract/internal';

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

function isIssues(check: Checked<unknown>): check is Extract<Checked<unknown>, { kind: 'issues' }> {
  return check.kind === 'issues';
}

function checkedValueOf(check: Checked<unknown>): unknown {
  return check.kind === 'value' ? check.value : undefined;
}
