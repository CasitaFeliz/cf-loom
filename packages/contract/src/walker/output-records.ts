import { type LocatedNode, nodesWithin } from './children.ts';
import type { NotAllowed } from './nodes.ts';
import { refused } from './not-allowed.ts';
import type { Defs } from './walk.ts';

/**
 * Every record keyed by an enum or literal in an output, or in a def an output reaches through
 * `ref`s: it refuses keys outside its key schema, so a reader would fail on a key its writer adds.
 * Each def is judged once, where it is.
 */
export function outputRecordsOf(
  outputs: readonly LocatedNode[],
  defs: Defs,
): readonly NotAllowed[] {
  const reached = new Map<string, LocatedNode>();
  reachDefs(outputs, defs, reached);
  const located = [...outputs, ...reached.values()].flatMap(({ at, node }) =>
    nodesWithin(node, at),
  );
  return located
    .filter(isKeyedRecord)
    .map(({ at }) => ({ kind: 'not-allowed', at, ...refused.outputRecord }));
}

/** Adds to `reached` every def the nodes reach, directly or through other defs, each once. */
function reachDefs(
  located: readonly LocatedNode[],
  defs: Defs,
  reached: Map<string, LocatedNode>,
): void {
  for (const { node } of located.flatMap(({ at, node: outer }) => nodesWithin(outer, at))) {
    const def = node.type === 'ref' ? defs[node.name] : undefined;
    if (node.type !== 'ref' || def === undefined || reached.has(node.name)) {
      continue;
    }
    const definition = { at: ['defs', node.name], node: def };
    reached.set(node.name, definition);
    reachDefs([definition], defs, reached);
  }
}

/** A strict object: since a Contract declares no strictness, what a keyed record walks to. */
function isKeyedRecord({ node }: LocatedNode): boolean {
  return node.type === 'object' && node.mode === 'strict';
}
