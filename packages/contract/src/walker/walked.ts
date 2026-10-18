import type * as core from 'zod/v4/core';
import type { Field, NotAllowed, Path, SchemaNode } from './nodes.ts';

/** A schema of a Snapshot, and where it sits in it. */
export type LocatedSchema = { readonly at: Path; readonly schema: core.$ZodType };

/** One schema walked: its value, or every construct in it that is not allowed. */
export type Walked<Value = SchemaNode> =
  | { readonly kind: 'walked'; readonly value: Value }
  | { readonly kind: 'not-allowed'; readonly failures: readonly NotAllowed[] };

/** How a part of the walk walks the schemas inside the one it walks, with the walk's shared state. */
export type Walker = {
  readonly schema: (schema: core.$ZodType, at: Path) => Walked;
  readonly field: (schema: core.$ZodType, at: Path) => Walked<Field>;
};

/** A walked value, as the walk of a schema returns it. */
export function walked<Value>(value: Value): Walked<Value> {
  return { kind: 'walked', value };
}

/**
 * Every value when each walked, else every failure of all of them, so none hides another; a
 * schema whose failure was already reported fails with none.
 */
export function allWalked<Value>(list: readonly Walked<Value>[]): Walked<readonly Value[]> {
  if (list.some(isNotAllowed)) {
    return { kind: 'not-allowed', failures: failuresOf(list) };
  }
  return walked(list.filter(isWalked).map((success) => success.value));
}

/** Every failure among walked values, in order. */
export function failuresOf(list: readonly Walked<unknown>[]): readonly NotAllowed[] {
  return list.filter(isNotAllowed).flatMap((failure) => failure.failures);
}

function isWalked<Value>(
  result: Walked<Value>,
): result is { readonly kind: 'walked'; readonly value: Value } {
  return result.kind === 'walked';
}

function isNotAllowed(
  result: Walked<unknown>,
): result is { readonly kind: 'not-allowed'; readonly failures: readonly NotAllowed[] } {
  return result.kind === 'not-allowed';
}
