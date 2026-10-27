import { type Defs, reachedDefsOf, type SchemaNode, shapeKey } from '../walker/index.ts';
import { type BothDefs, type NodePair, shapeKeyBesidesNullability } from './findings.ts';

/**
 * The pairs of schemas a hop entered within a root schema, by their nodes: a def by its node in
 * its Snapshot's defs, a schema written inline by itself.
 */
export type Entered = Map<SchemaNode, Set<SchemaNode>>;

/**
 * A pair holding a `ref`, one hop on: each `ref` becomes the def it names in its Snapshot's defs,
 * itself a `ref` when that def is an alias def, and a side written inline stays. `undefined` when
 * the hop's pair was already entered within the root schema, since any difference in it was found
 * where it was first met; otherwise the hop's pair is recorded as entered.
 */
export function hopOf(pair: NodePair, defs: BothDefs, entered: Entered): NodePair | undefined {
  const hop = {
    baseline: defOf(pair.baseline, defs.baseline),
    proposed: defOf(pair.proposed, defs.proposed),
  };
  const proposedEntered = entered.get(hop.baseline) ?? new Set<SchemaNode>();
  if (proposedEntered.has(hop.proposed)) {
    return undefined;
  }
  entered.set(hop.baseline, proposedEntered.add(hop.proposed));
  return hop;
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
