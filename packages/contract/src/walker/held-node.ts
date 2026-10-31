import { editedCopyOf, type NodeEdit } from './node-edits.ts';
import type { SchemaNode } from './nodes.ts';
import { byShape, shapeKey } from './shapes.ts';

/**
 * A node as a Snapshot holds it: the edits applied in order to one copy of the node, each `child`
 * at the step the node had before any edit, then an `allOf`'s items in shape order, each shape
 * once, the first kept with its annotations. Its children are taken as already held, since every
 * builder builds from the leaves up. An edit the node has no place for is a bug of the caller.
 */
export function heldNodeOf(node: SchemaNode, edits: readonly NodeEdit[]): SchemaNode {
  const edited = edits.length === 0 ? node : editedCopyOf(node, edits);
  return edited.type === 'allOf' ? { ...edited, items: inShapeOrder(edited.items) } : edited;
}

/**
 * An intersection's items as a Snapshot holds them: each shape once, the first declared kept with
 * its annotations, in shape order, so no annotation decides an item's place or whether two are one.
 */
function inShapeOrder(items: readonly SchemaNode[]): readonly SchemaNode[] {
  const firstByShape = new Map<string, SchemaNode>();
  for (const item of items) {
    const key = shapeKey(item);
    if (!firstByShape.has(key)) {
      firstByShape.set(key, item);
    }
  }
  return [...firstByShape.values()].sort(byShape);
}

/** A node as a def holds it: plain, since every `ref` to a def carries its own `nullable`. */
export function withoutNullable(node: SchemaNode): SchemaNode {
  const { nullable: _nullable, ...rest } = node;
  return rest;
}
