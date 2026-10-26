import type * as core from 'zod/v4/core';
import { byCodePoint } from './canonical-json.ts';
import { type Place, sameSite, siteLocationOf } from './location.ts';
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

/** An `allOf` or a `union` node a walk built for a schema, and where: judged once the walk's defs are known. */
export type Composition = { readonly at: Reached; readonly node: AllOfNode | UnionNode };

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

/** A failed walk, from failures a caller already knows are there: none at all is a bug. */
export function failed(failures: readonly NotAllowed[], outline?: Outline): Failed {
  const [first, ...others] = onePerSite(failures);
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

/**
 * One failure for each construct of each schema at each site, the first in code point order: a
 * schema reached by many paths adds no line for the others, and without this a def used twice by
 * each of many defs would be told once for every path.
 */
function onePerSite(failures: readonly NotAllowed[]): readonly NotAllowed[] {
  const kept: NotAllowed[] = [];
  for (const failure of failures) {
    const at = kept.findIndex((known) => isSameReach(known, failure));
    const known = kept[at];
    if (known === undefined) {
      kept.push(failure);
    } else if (byCodePoint(locationOf(failure), locationOf(known)) < 0) {
      kept[at] = failure;
    }
  }
  return kept;
}

/** Whether two failures say one thing: one construct of one schema, in one site of one declaration. */
function isSameReach(left: NotAllowed, right: NotAllowed): boolean {
  return (
    left.schema === right.schema &&
    left.construct === right.construct &&
    left.declaration === right.declaration &&
    sameSite(left.site, right.site)
  );
}

function locationOf({ site, steps }: NotAllowed): string {
  return siteLocationOf(site, steps);
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
