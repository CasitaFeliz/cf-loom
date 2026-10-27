import { leadsBackWithNoNode } from './children.ts';
import type { RefNode } from './nodes.ts';
import {
  notAllowed,
  refused,
  refusedAcyclicId,
  refusedDuplicateId,
  refusedNullableDef,
} from './not-allowed.ts';
import { type Ancestor, isRemembered, type State } from './recursion-state.ts';
import { type Failed, failed, refusedBeside, type Walked, walked } from './walked.ts';

/**
 * An id names a cycle: on a schema that lies on none it is refused, beside any other failure. A
 * walk that refused a schema inside for its depth did not see all it reaches, so it does not judge.
 */
export function offCycle(state: State, ancestor: Ancestor, node: Walked): Walked {
  if (ancestor.id === undefined || isWalkedInPart(state, node)) {
    return node;
  }
  return refusedBeside(notAllowed(ancestor.at, refusedAcyclicId(ancestor.id)), node);
}

/**
 * A schema with an id on a cycle is walked once: its def, or its failures, kept for every use,
 * each of which is a `ref` to it. A def is never nullable: `.nullable()` belongs to a use, so a
 * schema that admits `null` is refused as a def, through `z.lazy()` or an intersection included.
 */
export function writeDef(state: State, ancestor: Ancestor, node: Walked): Walked {
  if (ancestor.id === undefined) {
    return isRemembered(state, ancestor.schema) ? withoutOutline(node) : node;
  }
  const ref: RefNode = { type: 'ref', name: ancestor.id };
  if (node.kind === 'not-allowed') {
    return dropOpenGroup(state, ancestor, failed(node.tree, ref));
  }
  const owner = state.schemaById.get(ancestor.id);
  if (owner !== undefined && owner !== ancestor.schema) {
    return notAllowed(ancestor.at, refusedDuplicateId(ancestor.id));
  }
  state.schemaById.set(ancestor.id, ancestor.schema);
  if (leadsBackWithNoNode(ancestor.id, node.value, state.defById)) {
    return dropOpenGroup(state, ancestor, notAllowed(ancestor.at, refused.nodelessCycle, ref));
  }
  if (node.value.nullable === true) {
    const refusal = notAllowed(ancestor.at, refusedNullableDef(ancestor.id), ref);
    return dropOpenGroup(state, ancestor, refusal);
  }
  state.nameBySchema.set(ancestor.schema, ancestor.id);
  state.defById.set(ancestor.id, node.value);
  state.openDefs.push({ schema: ancestor.schema, index: ancestor.index, low: ancestor.low });
  return walked(ref);
}

/**
 * Records the one failure of a def and drops the defs still open below it, which hold `ref`s to
 * it, so every use of any of them reports that failure. A dropped def leaves the open defs, so a
 * later failure higher up does not record itself over the first.
 */
function dropOpenGroup(state: State, ancestor: Ancestor, failure: Failed): Walked {
  state.reported.report(ancestor.schema, failure);
  const dropped = state.openDefs.filter((def) => def.index > ancestor.index);
  for (const { schema } of dropped) {
    const name = state.nameBySchema.get(schema);
    if (name !== undefined) {
      state.defById.delete(name);
    }
    state.nameBySchema.delete(schema);
    state.reported.report(schema, failure);
  }
  const remaining = state.openDefs.filter((def) => def.index <= ancestor.index);
  state.openDefs.splice(0, state.openDefs.length, ...remaining);
  return failure;
}

/**
 * A schema on a cycle no id names is judged as every schema of the cycle would be with an id: a
 * `ref` wherever it is used, which takes no check. So its walk was building no node for a use,
 * met again or ended, and only a check on the schema whose own def builds the node is taken.
 */
function withoutOutline(node: Walked): Walked {
  return node.kind === 'not-allowed' ? failed(node.tree) : node;
}

function isWalkedInPart(state: State, node: Walked): boolean {
  return node.kind === 'not-allowed' && state.reported.holdsWrittenTooDeep(node.tree);
}
