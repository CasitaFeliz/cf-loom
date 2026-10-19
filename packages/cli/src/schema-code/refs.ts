import { childrenOf, type SchemaNode } from '@casitafeliz/loom-contract/internal';

/** The ids of the recursive defs a node references directly, at any depth but through a `ref`. */
export function refsOf(node: SchemaNode): readonly string[] {
  if (node.type === 'ref') {
    return [node.name];
  }
  return childrenOf(node).flatMap((child) => refsOf(child.node));
}
