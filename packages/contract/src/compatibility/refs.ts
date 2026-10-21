import {
  canonicalJson,
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
 * `ref` or a def on the way is. It is `entered` the first time it is met within a root schema,
 * `unresolved` when a `ref` reaches no schema and the two sides differ, and `settled` when only
 * its nullability is left to compare, in either of two ways:
 * - it was already entered within the same root schema, so any difference in it was found there;
 * - both sides are the same `ref` that reaches no schema, down the same alias chain.
 */
export type Followed =
  | { readonly kind: 'inline'; readonly pair: NodePair }
  | { readonly kind: 'entered'; readonly pair: NodePair; readonly entered: EnteredKey }
  | { readonly kind: 'settled'; readonly pair: NodePair }
  | { readonly kind: 'unresolved' };

/** One side of a pair with its `ref`s followed: the schema it stands for, or the alias chain that led nowhere. */
type Side =
  | { readonly kind: 'resolved'; readonly node: SchemaNode; readonly key: string | SchemaNode }
  | { readonly kind: 'unresolved'; readonly chain: readonly string[] };

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
  if (baseline.kind === 'unresolved' || proposed.kind === 'unresolved') {
    return hasSameChain(baseline, proposed) ? { kind: 'settled', pair } : { kind: 'unresolved' };
  }
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
  return node.type === 'ref' ? followRef(node, defs, []) : { kind: 'resolved', node, key: node };
}

/** A `ref` followed through alias defs to the schema it stands for, or until a def is missing or an alias comes back. */
function followRef(ref: RefNode, defs: Defs, followed: readonly RefNode[]): Side {
  const chain = [...followed, ref];
  const def = defs[ref.name];
  if (def === undefined || followed.some((earlier) => earlier.name === ref.name)) {
    return { kind: 'unresolved', chain: chain.map(shapeKey) };
  }
  const reached: Side =
    def.type === 'ref'
      ? followRef(def, defs, chain)
      : { kind: 'resolved', node: def, key: ref.name };
  if (reached.kind === 'unresolved' || ref.nullable !== true) {
    return reached;
  }
  return { ...reached, node: { ...reached.node, nullable: true } };
}

/** Whether both sides lead nowhere down alias chains of the same shape, nullability included. */
function hasSameChain(baseline: Side, proposed: Side): boolean {
  return (
    baseline.kind === 'unresolved' &&
    proposed.kind === 'unresolved' &&
    canonicalJson(baseline.chain) === canonicalJson(proposed.chain)
  );
}

function hasEntered(entered: readonly EnteredKey[], key: EnteredKey): boolean {
  return entered.some((pair) => pair.baseline === key.baseline && pair.proposed === key.proposed);
}
