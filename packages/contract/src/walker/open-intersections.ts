import { type LocatedNode, nodesReachedFrom, nodesWithin } from './children.ts';
import type { NotAllowed, Path } from './nodes.ts';
import { refused } from './not-allowed.ts';
import type { Defs } from './walk.ts';

/**
 * Every outermost `allOf` in the schemas, or in a def at `['defs', <id>]`, that reaches an Open
 * Enum or an Open Union: a reader of an intersection merges what each item read, and an Unknown
 * case and the value it came from never merge. Each def is judged once, where it is, whether or
 * not the schemas using it walked.
 */
export function openIntersectionsOf(
  schemas: readonly LocatedNode[],
  defs: Defs,
): readonly NotAllowed[] {
  const located = [...schemas, ...Object.entries(defs).map(([id, def]) => defAt(id, def))];
  const reported: Path[] = [];
  for (const { at, node } of located.flatMap((schema) => nodesWithin(schema.node, schema.at))) {
    const isInsideReported = reported.some((outer) => isInside(at, outer));
    if (node.type === 'allOf' && !isInsideReported && reachesOpen({ at, node }, defs)) {
      reported.push(at);
    }
  }
  return reported.map((at) => ({ kind: 'not-allowed', at, ...refused.openIntersection }));
}

function defAt(id: string, def: LocatedNode['node']): LocatedNode {
  return { at: ['defs', id], node: def };
}

/** Whether a path lies under another, which the walk of nodes lists first. */
function isInside(at: Path, outer: Path): boolean {
  return outer.length < at.length && outer.every((step, index) => at[index] === step);
}

/** Whether a node reaches an Open Enum or an Open Union, through `ref`s. */
function reachesOpen(located: LocatedNode, defs: Defs): boolean {
  return nodesReachedFrom([located], defs).some(isOpenChoice);
}

function isOpenChoice({ node }: LocatedNode): boolean {
  return (node.type === 'enum' || node.type === 'tagged') && node.open;
}
