import {
  type Defs,
  type RefNode,
  reachedDefsOf,
  type SchemaNode,
  shapeKey,
} from '../walker/index.ts';
import { type BothDefs, type NodePair, shapeKeyBesidesNullability } from './findings.ts';

/**
 * The key of a pair of schemas compared where a `ref` was followed: each side by the name of the
 * def it reaches, or by the node itself when that side is written inline.
 */
export type EnteredKey = {
  readonly baseline: string | SchemaNode;
  readonly proposed: string | SchemaNode;
};

/**
 * A pair with every `ref` followed into its Snapshot's defs, through alias defs, nullable when the
 * `ref` or a def on the way is. It is `entered` the first time it is met within a root schema, and
 * `settled` when it was already entered within the same root schema, so any difference in it was
 * found there and only its nullability is left to compare.
 */
export type Followed =
  | { readonly kind: 'inline'; readonly pair: NodePair }
  | { readonly kind: 'entered'; readonly pair: NodePair; readonly entered: EnteredKey }
  | { readonly kind: 'settled'; readonly pair: NodePair };

/** One side of a pair with its `ref`s followed: the schema it stands for, and the key to enter it by. */
type Side = { readonly node: SchemaNode; readonly key: string | SchemaNode };

/**
 * Follows the `ref`s of a pair into both Snapshots' defs, so a def is compared as if written
 * inline. A pair already `entered` within the root schema compares no further, since any
 * difference in it was found where it was first met.
 */
export function followedOf(
  pair: NodePair,
  defs: BothDefs,
  entered: readonly EnteredKey[],
): Followed {
  if (pair.baseline.type !== 'ref' && pair.proposed.type !== 'ref') {
    return { kind: 'inline', pair };
  }
  const baseline = sideOf(pair.baseline, defs.baseline);
  const proposed = sideOf(pair.proposed, defs.proposed);
  const key = { baseline: baseline.key, proposed: proposed.key };
  const resolved = { baseline: baseline.node, proposed: proposed.node };
  return hasEntered(entered, key)
    ? { kind: 'settled', pair: resolved }
    : { kind: 'entered', pair: resolved, entered: key };
}

/**
 * Whether two nodes have the same shape, apart from their own nullability, and every def their
 * `ref`s reach has the same shape on both sides. No def is compared by Position.
 */
export function isUnchanged({ baseline, proposed }: NodePair, defs: BothDefs): boolean {
  const hasSameShape =
    shapeKeyBesidesNullability(baseline) === shapeKeyBesidesNullability(proposed);
  return (
    hasSameShape && reachedDefsOf([baseline], defs.baseline).every((name) => hasSameDef(name, defs))
  );
}

function hasSameDef(name: string, defs: BothDefs): boolean {
  const baseline = defs.baseline[name];
  const proposed = defs.proposed[name];
  return (
    baseline !== undefined && proposed !== undefined && shapeKey(baseline) === shapeKey(proposed)
  );
}

function sideOf(node: SchemaNode, defs: Defs): Side {
  return node.type === 'ref' ? followRef(node, defs, []) : { node, key: node };
}

/**
 * A `ref` followed through alias defs to the schema it stands for. A missing def, or an alias
 * that comes back to one already followed, is a bug, thrown so the walk never loops.
 */
function followRef(ref: RefNode, defs: Defs, followed: readonly RefNode[]): Side {
  const def = defs[ref.name];
  if (def === undefined || followed.some((earlier) => earlier.name === ref.name)) {
    throw new Error(`\`ref\` to ${ref.name} reaches no schema: a bug.`);
  }
  const reached: Side =
    def.type === 'ref' ? followRef(def, defs, [...followed, ref]) : { node: def, key: ref.name };
  return ref.nullable === true
    ? { ...reached, node: { ...reached.node, nullable: true } }
    : reached;
}

function hasEntered(entered: readonly EnteredKey[], key: EnteredKey): boolean {
  return entered.some((pair) => pair.baseline === key.baseline && pair.proposed === key.proposed);
}
