import {
  type Defs,
  type RefNode,
  reachedDefsOf,
  type SchemaNode,
  shapeKey,
} from '../walker/index.ts';
import { type BothDefs, type NodePair, shapeKeyBesidesNullability } from './findings.ts';

/**
 * A pair of schemas entered where a `ref` was followed: each side by the name of the def it
 * reaches, or by the node itself when it is written inline.
 */
export type RefPair = {
  readonly baseline: string | SchemaNode;
  readonly proposed: string | SchemaNode;
};

/**
 * A pair with every `ref` followed into its Snapshot's defs, through alias defs, nullable when the
 * `ref` or a def on the way is. It is entered, or settled when only its nullability is left to
 * compare: it was met again on its own path, or its `ref`s are unchanged. It is unresolved when a
 * `ref` reaches no schema and the two sides differ.
 */
export type Followed =
  | { readonly kind: 'inline'; readonly pair: NodePair }
  | { readonly kind: 'entered'; readonly pair: NodePair; readonly entered: RefPair }
  | { readonly kind: 'settled'; readonly pair: NodePair }
  | { readonly kind: 'unresolved' };

type Resolved = { readonly node: SchemaNode; readonly key: string | SchemaNode };

/**
 * Follows the `ref`s of a pair into both Snapshots' defs, so a def is compared as if written
 * inline. A pair met again among the ones `entered` on the path compares no further, since any
 * difference in it was found where it was first met.
 */
export function followedOf(pair: NodePair, defs: BothDefs, entered: readonly RefPair[]): Followed {
  if (pair.baseline.type !== 'ref' && pair.proposed.type !== 'ref') {
    return { kind: 'inline', pair };
  }
  const baseline = resolvedOf(pair.baseline, defs.baseline);
  const proposed = resolvedOf(pair.proposed, defs.proposed);
  if (baseline === undefined || proposed === undefined) {
    const isIdentical =
      baseline === proposed && shapeKey(pair.baseline) === shapeKey(pair.proposed);
    return isIdentical ? { kind: 'settled', pair } : { kind: 'unresolved' };
  }
  const resolved = { baseline: baseline.node, proposed: proposed.node };
  const key = { baseline: baseline.key, proposed: proposed.key };
  if (hasEntered(entered, key) || areUnchangedRefs(pair, defs)) {
    return { kind: 'settled', pair: resolved };
  }
  return { kind: 'entered', pair: resolved, entered: key };
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

function resolvedOf(node: SchemaNode, defs: Defs): Resolved | undefined {
  return node.type === 'ref' ? followRef(node, defs, []) : { node, key: node };
}

/** A `ref` followed through alias defs to the schema it stands for, or none when a def is missing or an alias comes back. */
function followRef(ref: RefNode, defs: Defs, followed: readonly string[]): Resolved | undefined {
  const def = defs[ref.name];
  if (def === undefined || followed.includes(ref.name)) {
    return undefined;
  }
  const reached =
    def.type === 'ref'
      ? followRef(def, defs, [...followed, ref.name])
      : { node: def, key: ref.name };
  if (reached === undefined || ref.nullable !== true) {
    return reached;
  }
  return { ...reached, node: { ...reached.node, nullable: true } };
}

function hasEntered(entered: readonly RefPair[], key: RefPair): boolean {
  return entered.some((pair) => pair.baseline === key.baseline && pair.proposed === key.proposed);
}

function areUnchangedRefs(pair: NodePair, defs: BothDefs): boolean {
  return pair.baseline.type === 'ref' && pair.proposed.type === 'ref' && isUnchanged(pair, defs);
}
