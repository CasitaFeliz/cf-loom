import { childrenOf } from './children.ts';
import type { NotAllowed, Path, SchemaNode } from './nodes.ts';
import { refused } from './not-allowed.ts';
import type { Defs } from './walk.ts';

/**
 * Every `allOf` in a schema, or in a def at `['defs', <id>]`, that reaches an Open Enum or an
 * Open Union: a reader of an intersection merges what each item read, and an Unknown case and the
 * value it came from never merge. A `ref` is not entered, since each def is judged once itself.
 */
export function openIntersectionsOf(node: SchemaNode, at: Path, defs: Defs): readonly NotAllowed[] {
  if (node.type === 'allOf' && reachesOpen(node, defs, new Set())) {
    return [{ kind: 'not-allowed', at, ...refused.openIntersection }];
  }
  return childrenOf(node).flatMap(({ steps, node: child }) =>
    openIntersectionsOf(child, [...at, ...steps], defs),
  );
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
