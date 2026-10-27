import type * as core from 'zod/v4/core';
import type { Place } from './location.ts';
import type { AllOfNode, Field, NotAllowed, Origin, SchemaNode, UnionNode } from './nodes.ts';

/** A schema of a Snapshot, and where it sits in it. */
export type LocatedSchema = { readonly at: Place; readonly schema: core.$ZodType };

/**
 * The refusals of a failed walk, held as the trees of what it holds: a failing schema used many
 * times is held, never copied, so a walk's failures cost what its schemas do.
 */
export type FailureTree = readonly (NotAllowed | FailureTree)[];

/**
 * The node a failed walk was building, as far as it got: its type, and the constraints already
 * set on it, so its checks are judged as the node's would be. A refused construct that holds no
 * single schema (`z.set()`, `.pipe()`, a refused type), or a schema on a cycle no id names, builds
 * none.
 */
export type Outline = Partial<SchemaNode>;

/** A failed walk: the tree of every construct in it that is not allowed, and the node it was building. */
export type Failed = {
  readonly kind: 'not-allowed';
  readonly tree: FailureTree;
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

/** A failed walk, from refusals or failure trees a caller already knows are there: an empty tree is a bug. */
export function failed(tree: FailureTree, outline?: Outline): Failed {
  if (tree.length === 0) {
    throw new Error('A failed walk must name the construct that is not allowed.');
  }
  return { kind: 'not-allowed', tree, ...(outline && { outline }) };
}

/**
 * Every refusal in the tree, each once, in the order a walk first meets it: a refusal or subtree
 * already in `seen` is skipped whole, and each one met joins it, so a walk-wide `seen` takes each once.
 */
export function refusalsIn(
  tree: FailureTree,
  seen: Set<NotAllowed | FailureTree> = new Set(),
): readonly NotAllowed[] {
  const refusals: NotAllowed[] = [];
  const pending: (NotAllowed | FailureTree)[] = [tree];
  for (let item = pending.pop(); item !== undefined; item = pending.pop()) {
    if (seen.has(item)) {
      continue;
    }
    seen.add(item);
    if (!isFailureTree(item)) {
      refusals.push(item);
      continue;
    }
    for (const part of item.toReversed()) {
      pending.push(part);
    }
  }
  return refusals;
}

/** Whether a part of a failure tree is a subtree and not a refusal. */
export function isFailureTree(part: NotAllowed | FailureTree): part is FailureTree {
  return Array.isArray(part);
}

/** A refused construct reported beside the walk of what it holds, whose node it stands for. */
export function refusedBeside(refusal: Failed, inner: Walked): Failed {
  return failed(failuresOf([refusal, inner]), outlineOf(inner));
}

/** The node a walk built, or the one it was building when it failed. */
export function outlineOf(walkedSchema: Walked): Outline {
  return walkedSchema.kind === 'walked' ? walkedSchema.value : (walkedSchema.outline ?? {});
}

/** The failure trees of the failed ones among walked values, in order. */
export function failuresOf(list: readonly Walked<unknown>[]): FailureTree {
  return list.filter(isNotAllowed).map((failure) => failure.tree);
}

function isWalked<Value>(
  result: Walked<Value>,
): result is { readonly kind: 'walked'; readonly value: Value } {
  return result.kind === 'walked';
}

function isNotAllowed(result: Walked<unknown>): result is Failed {
  return result.kind === 'not-allowed';
}
