import { unbrokenLineOf } from '../lines/index.ts';
import { type Defs, defGraphOf, type SchemaNode } from '../walker/index.ts';
import type { BothDefs, NodePair } from './findings.ts';

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

/** Whether a pair was already entered within its root schema. */
export function hasEntered(entered: Entered, { baseline, proposed }: NodePair): boolean {
  return entered.get(baseline)?.has(proposed) === true;
}

/** The def a `ref` names, or the node itself when it is written inline: a name with no def is a bug. */
function defOf(node: SchemaNode, defs: Defs): SchemaNode {
  if (node.type !== 'ref') {
    return node;
  }
  const def = defGraphOf(defs).def(node.name);
  if (def === undefined) {
    throw new Error(unbrokenLineOf(`\`ref\` to ${node.name} reaches no schema: a bug.`));
  }
  return def;
}
