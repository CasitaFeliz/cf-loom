import type * as core from 'zod/v4/core';
import type { Field, NotAllowed, Path, SchemaNode } from './nodes.ts';

/** A schema of a Snapshot, and where it sits in it. */
export type LocatedSchema = { readonly at: Path; readonly schema: core.$ZodType };

/** Every construct that is not allowed in a schema: a failed walk names at least one. */
export type Failures = readonly [NotAllowed, ...NotAllowed[]];

/** One schema walked: its value, or every construct in it that is not allowed. */
export type Walked<Value = SchemaNode> =
  | { readonly kind: 'walked'; readonly value: Value }
  | { readonly kind: 'not-allowed'; readonly failures: Failures };

/** How a part of the walk walks the schemas inside the one it walks, with the walk's shared state. */
export type Walker = {
  readonly schema: (schema: core.$ZodType, at: Path) => Walked;
  readonly field: (schema: core.$ZodType, at: Path) => Walked<Field>;
};

/** A walked value, as the walk of a schema returns it. */
export function walked<Value>(value: Value): Walked<Value> {
  return { kind: 'walked', value };
}

/** Every value when each walked, else every failure of all of them, so none hides another. */
export function allWalked<Value>(list: readonly Walked<Value>[]): Walked<readonly Value[]> {
  if (list.some(isNotAllowed)) {
    return failed(failuresOf(list));
  }
  return walked(list.filter(isWalked).map((success) => success.value));
}

/** A failed walk, from failures a caller already knows are there: none at all is a bug. */
export function failed(failures: readonly NotAllowed[]): Walked<never> {
  const [first, ...others] = failures;
  if (first === undefined) {
    throw new Error('A failed walk must name the construct that is not allowed.');
  }
  return { kind: 'not-allowed', failures: [first, ...others] };
}

/**
 * Failures with each refusal once where it was written, as a failure reported for a cycle comes
 * back wherever it is met and a construct stacked on itself refuses itself again.
 */
export function distinctFailures(failures: Failures): Failures {
  const [first, ...others] = failures;
  const written = new Set([writtenKeyOf(first)]);
  const distinctOthers: NotAllowed[] = [];
  for (const failure of others) {
    const key = writtenKeyOf(failure);
    if (!written.has(key)) {
      written.add(key);
      distinctOthers.push(failure);
    }
  }
  return [first, ...distinctOthers];
}

function writtenKeyOf({ at, construct }: NotAllowed): string {
  return JSON.stringify([at, construct]);
}

/** Every failure among walked values, each once, in order. */
export function failuresOf(list: readonly Walked<unknown>[]): readonly NotAllowed[] {
  return [...new Set(list.filter(isNotAllowed).flatMap((failure) => failure.failures))];
}

function isWalked<Value>(
  result: Walked<Value>,
): result is { readonly kind: 'walked'; readonly value: Value } {
  return result.kind === 'walked';
}

function isNotAllowed(
  result: Walked<unknown>,
): result is { readonly kind: 'not-allowed'; readonly failures: Failures } {
  return result.kind === 'not-allowed';
}
