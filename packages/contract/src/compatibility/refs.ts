import { type Defs, reachedDefsOf, type SchemaNode, shapeKey } from '../walker/index.ts';
import { type BothDefs, type NodePair, shapeKeyBesidesNullability } from './findings.ts';

/**
 * The pairs of schemas a hop entered within a root schema, by their nodes: a def by its node in
 * its Snapshot's defs, a schema written inline by itself.
 */
export type Entered = Map<SchemaNode, Set<SchemaNode>>;

/**
 * A pair holding a `ref`, one hop on: each `ref` becomes the def it names in its Snapshot's defs,
 * itself a `ref` when that def is an alias def, and a side written inline stays.
 */
export function hopOf(pair: NodePair, defs: BothDefs): NodePair {
  return {
    baseline: defOf(pair.baseline, defs.baseline),
    proposed: defOf(pair.proposed, defs.proposed),
  };
}

/** Whether a pair is entered for the first time within its root schema, recording it as entered. */
export function isFirstEntered(entered: Entered, { baseline, proposed }: NodePair): boolean {
  const proposedEntered = entered.get(baseline) ?? new Set<SchemaNode>();
  if (proposedEntered.has(proposed)) {
    return false;
  }
  entered.set(baseline, proposedEntered.add(proposed));
  return true;
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

/** The def a `ref` names, or the node itself when it is written inline: a name with no def is a bug. */
function defOf(node: SchemaNode, defs: Defs): SchemaNode {
  if (node.type !== 'ref') {
    return node;
  }
  const def = defs[node.name];
  if (def === undefined) {
    throw new Error(`\`ref\` to ${node.name} reaches no schema: a bug.`);
  }
  return def;
}
