import { childrenOf, heldNodeOf, type SchemaNode } from '../walker/index.ts';
import { copyMet, followedRefOf } from './graft-names.ts';
import { defPut, type Frame, type Put, renamedRef, type Walk } from './graft-walk.ts';

/** A node only the former Input has, copied as it was, each def it reaches copied and named apart. */
export function placeCopy(walk: Walk, node: SchemaNode, put: Put): void {
  if (node.type !== 'ref') {
    const children = childrenOf(node).values();
    walk.frames.push({ kind: 'copy', children, node, edits: [], put });
    return;
  }
  const resolved = followedRefOf(node, walk.resolve.baseline);
  const { name, isBuilt } = copyMet(walk.met, resolved.name);
  put(renamedRef(node, { name: name ?? resolved.name, nullable: resolved.nullable }));
  if (isBuilt) {
    placeCopy(walk, resolved.def, defPut(walk, name));
  }
}

/** Copies the next child of a node being copied, or builds the node once its children are copied. */
export function stepCopy(walk: Walk, frame: Extract<Frame, { kind: 'copy' }>): void {
  const next = frame.children.next();
  if (next.done === true) {
    walk.frames.pop();
    frame.put(heldNodeOf(frame.node, frame.edits));
    return;
  }
  const [step] = next.value.steps;
  if (step !== undefined) {
    placeCopy(walk, next.value.node, (child) => {
      frame.edits.push({ kind: 'child', step, node: child });
    });
  }
}
