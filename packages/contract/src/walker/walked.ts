import type * as core from 'zod/v4/core';
import type { Place } from './location.ts';
import type { AllOfNode, Field, NotAllowed, Origin, SchemaNode, UnionNode } from './nodes.ts';

/** A schema of a Snapshot, and where it sits in it. */
export type LocatedSchema = { readonly at: Place; readonly schema: core.$ZodType };

/** Every construct that is not allowed in a schema: a failed walk names at least one. */
export type Failures = readonly [NotAllowed, ...NotAllowed[]];

/**
 * The node a failed walk was building, as far as it got: its type, and the constraints already
 * set on it, so its checks are judged as the node's would be. A refused construct that holds no
 * single schema (`z.set()`, `.pipe()`, a refused type), or a schema on a cycle no id names, builds
 * none.
 */
export type Outline = Partial<SchemaNode>;

/** A failed walk: every construct in it that is not allowed, and the node it was building. */
export type Failed = {
  readonly kind: 'not-allowed';
  readonly failures: Failures;
  readonly outline?: Outline;
};

/** One schema walked: its value, or every construct in it that is not allowed. */
export type Walked<Value = SchemaNode> =
  | { readonly kind: 'walked'; readonly value: Value }
  | Failed;

/**
 * Where the walk is: a place, the schema being walked there and the nearest origin of a
 * Definitions Package around it, which a refusal there tells.
 */
export type Reached = Place & {
  readonly schema: core.$ZodType;
  readonly origin: Origin | undefined;
};

/** A place under a schema being walked, which passes its origin down to the schema entered there. */
export type Under = Place & { readonly origin?: Origin | undefined };

/** A schema the walk enters and the place it enters it at. */
export type ReachedSchema = { readonly at: Reached; readonly schema: core.$ZodType };

/**
 * An `allOf` or a `union` node a walk built, and the refusal it is where it was built if the defs,
 * once known, show it reaches an Open Enum.
 */
export type Composition = { readonly refusal: NotAllowed; readonly node: AllOfNode | UnionNode };

/** One place a schema the walk remembers is entered, inside the walk of another remembered schema or of none. */
export type Reach = { readonly at: Reached; within: Memo | undefined };

/**
 * A schema the walk entered once and answers from memory after: a def, a def that failed or a
 * member of a cycle no id names. Where the walk entered it, and every place it is reached, that
 * first place included; what was raised inside it sits under that first place.
 */
export type Memo = { readonly at: Reached; readonly reaches: Reach[] };

/**
 * The schemas of a cycle no id names, as the walk that refused it entered them: the first is the
 * one it met again, so where the cycle closes from each is told by the steps around the cycle.
 */
export type Loop = readonly [Memo, ...Memo[]];

/** How a part of the walk walks the schemas inside the one it walks, with the walk's shared state. */
export type Walker = {
  readonly schema: (schema: core.$ZodType, at: Under) => Walked;
  readonly field: (schema: core.$ZodType, at: Under) => Walked<Field>;
  /** The place a schema is entered at, which a refusal raised at the schema tells. */
  readonly reach: (schema: core.$ZodType, at: Under) => Reached;
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

/** A failed walk, from failures a caller already knows are there, each once: none at all is a bug. */
export function failed(failures: readonly NotAllowed[], outline?: Outline): Failed {
  const [first, ...others] = new Set(failures);
  if (first === undefined) {
    throw new Error('A failed walk must name the construct that is not allowed.');
  }
  return { kind: 'not-allowed', failures: [first, ...others], ...(outline && { outline }) };
}

/** A refused construct reported beside the walk of what it holds, whose node it stands for. */
export function refusedBeside(refusal: Failed, inner: Walked): Failed {
  return failed(failuresOf([refusal, inner]), outlineOf(inner));
}

/** The node a walk built, or the one it was building when it failed. */
export function outlineOf(walkedSchema: Walked): Outline {
  return walkedSchema.kind === 'walked' ? walkedSchema.value : (walkedSchema.outline ?? {});
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

function isNotAllowed(result: Walked<unknown>): result is Failed {
  return result.kind === 'not-allowed';
}
