import { type LocatedNode, nodesReachedFrom } from './children.ts';
import type { NotAllowed, Path } from './nodes.ts';
import { type Refused, refused } from './not-allowed.ts';
import type { Defs } from './walk.ts';

/**
 * The schemas a record keyed by an enum or literal is refused in: a query or headers object as a
 * whole, and a Read shape at any depth.
 */
export type KeyedRecordSlots = {
  readonly queryOrHeaders: readonly LocatedNode[];
  readonly readShapes: readonly LocatedNode[];
};

/**
 * Every record keyed by an enum or literal that refuses keys a request or a writer may add: a
 * query or headers object that is one, and one in a Read shape or a def it reaches, judged once.
 */
export function keyedRecordsOf(slots: KeyedRecordSlots, defs: Defs): readonly NotAllowed[] {
  const asQueryOrHeaders = slots.queryOrHeaders.filter(isKeyedRecord);
  const inReadShapes = nodesReachedFrom(slots.readShapes, defs).filter(isKeyedRecord);
  return [
    ...asQueryOrHeaders.map(({ at }) => refusal(at, refused.keyedRecordAsQueryOrHeaders)),
    ...inReadShapes.map(({ at }) => refusal(at, refused.keyedRecordInReadShape)),
  ];
}

/**
 * A strict object: a Contract declares no strictness, so only a record keyed by an enum or literal
 * walks to one.
 */
function isKeyedRecord({ node }: LocatedNode): boolean {
  return node.type === 'object' && node.mode === 'strict';
}

function refusal(at: Path, construct: Refused): NotAllowed {
  return { kind: 'not-allowed', at, ...construct };
}
