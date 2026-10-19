import { type LocatedNode, nodesReachedFrom } from './children.ts';
import type { NotAllowed, Path, SchemaNode } from './nodes.ts';
import { type Refused, refused } from './not-allowed.ts';
import type { Defs } from './walk.ts';

/**
 * The schemas a record keyed by an enum or literal is refused in: a query or headers object as a
 * whole, and a Read shape's body at any depth.
 */
export type KeyedRecordSlots = {
  readonly queryOrHeaders: readonly LocatedNode[];
  readonly readShapes: readonly LocatedNode[];
};

/**
 * Every record keyed by an enum or literal that refuses keys a request or a writer may add: a
 * query or headers object that is one, and one in a Read shape's body at any depth or in a def it
 * reaches, judged once.
 */
export function keyedRecordsOf(slots: KeyedRecordSlots, defs: Defs): readonly NotAllowed[] {
  const asQueryOrHeaders = slots.queryOrHeaders.filter(isLocatedKeyedRecord);
  const inReadShapes = nodesReachedFrom(slots.readShapes, defs).filter(isLocatedKeyedRecord);
  return [
    ...asQueryOrHeaders.map(({ at }) => refusal(at, refused.keyedRecordAsQueryOrHeaders)),
    ...inReadShapes.map(({ at }) => refusal(at, refused.keyedRecordInReadShape)),
  ];
}

/**
 * A strict object: a Contract declares no strictness, so only a record keyed by an enum or literal
 * walks to one.
 */
export function isKeyedRecord(node: SchemaNode): boolean {
  return node.type === 'object' && node.mode === 'strict';
}

function isLocatedKeyedRecord({ node }: LocatedNode): boolean {
  return isKeyedRecord(node);
}

function refusal(at: Path, construct: Refused): NotAllowed {
  return { kind: 'not-allowed', at, ...construct };
}
