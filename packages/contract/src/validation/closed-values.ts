import { lifecycles } from '../declarations/index.ts';
import { joinedOf, wordOf } from '../lines/index.ts';
import type { Place } from '../walker/index.ts';
import { writtenTextOf } from '../written/index.ts';
import { type DeclarationFailure, failure, type Rule } from './failures.ts';

/** A closed value a declaration takes, as the types state it, and the rule that judges it. */
export type ClosedValue = {
  readonly rule: Rule;
  readonly allowed: readonly unknown[];
  readonly noun: string;
};

/** The lifecycle every Element takes, judged alike on each kind. */
export const lifecycle: ClosedValue = {
  rule: 'lifecycle',
  allowed: lifecycles,
  noun: 'A lifecycle',
};

/** A value as written and where it sits. */
type WrittenValue = { readonly at: Place; readonly value: unknown };

/** A string present is one of the allowed; an absent one or a non-string is the field rules' finding. */
export function closedValueFailures(
  { at, value }: WrittenValue,
  { rule, allowed, noun }: ClosedValue,
): readonly DeclarationFailure[] {
  if (typeof value !== 'string' || allowed.includes(value)) {
    return [];
  }
  const values = joinedOf(
    allowed.map((value) => wordOf(String(value))),
    'or',
  );
  return [failure(at, rule, `${noun} is ${values}: ${writtenTextOf(value)}`)];
}
