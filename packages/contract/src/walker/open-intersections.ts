import { childrenOf, type LocatedNode, nodesReachedFrom } from './children.ts';
import type { NotAllowed, Path, SchemaNode } from './nodes.ts';
import { refused } from './not-allowed.ts';
import type { Defs } from './walk.ts';

/**
 * Every outermost `allOf` in the schemas, or in a def they reach, at `['defs', <id>]`, that
 * reaches an Open Enum or an Open Union: a reader of an intersection merges what each item read,
 * and an Unknown case and the value it came from never merge.
 */
export function openIntersectionsOf(
  schemas: readonly LocatedNode[],
  defs: Defs,
): readonly NotAllowed[] {
  const reported: Path[] = [];
  for (const { at, node } of nodesReachedFrom(schemas, defs)) {
    const isInsideReported = reported.some((outer) => isInside(at, outer));
    if (node.type === 'allOf' && !isInsideReported && reachesOpen(node, defs, new Set())) {
      reported.push(at);
    }
  }
  return reported.map((at) => ({ kind: 'not-allowed', at, ...refused.openIntersection }));
}

/** Whether a path lies under another, which the walk of nodes lists first. */
function isInside(at: Path, outer: Path): boolean {
  return outer.length < at.length && outer.every((step, index) => at[index] === step);
}

/** Whether a node reaches an Open Enum or an Open Union, through `ref`s, each def once. */
function reachesOpen(node: SchemaNode, defs: Defs, seen: ReadonlySet<string>): boolean {
  switch (node.type) {
    case 'enum':
      return node.open;
    case 'tagged':
      return node.open || childrenReachOpen(node, defs, seen);
    case 'ref': {
      const def = defs[node.name];
      if (def === undefined || seen.has(node.name)) {
        return false;
      }
      return reachesOpen(def, defs, new Set([...seen, node.name]));
    }
    case 'object':
    case 'record':
    case 'array':
    case 'tuple':
    case 'union':
    case 'allOf':
      return childrenReachOpen(node, defs, seen);
    case 'string':
    case 'number':
    case 'boolean':
    case 'literal':
    case 'json':
      return false;
  }
}

function childrenReachOpen(node: SchemaNode, defs: Defs, seen: ReadonlySet<string>): boolean {
  return childrenOf(node).some(({ node: child }) => reachesOpen(child, defs, seen));
}
