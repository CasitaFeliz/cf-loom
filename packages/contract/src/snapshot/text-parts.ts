import type { ObjectNode } from '../walker/index.ts';

/**
 * A text part's node in the mode the Snapshot stores it, whatever mode the zod object was written
 * with: params strict, headers open; `null` where the part is not declared.
 */
export function inMode(node: ObjectNode | undefined, mode: ObjectNode['mode']): ObjectNode | null {
  return node === undefined ? null : { ...node, mode };
}
