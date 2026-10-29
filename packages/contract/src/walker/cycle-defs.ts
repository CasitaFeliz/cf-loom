import { leadsBackWithNoNode } from './children.ts';
import { writtenIdOf } from './metadata.ts';
import type { RefNode } from './nodes.ts';
import {
  notAllowed,
  refused,
  refusedAcyclicId,
  refusedDuplicateId,
  refusedNullableDef,
} from './not-allowed.ts';
import { type Entered, isRemembered, type State } from './recursion-state.ts';
import { type Failed, failed, refusedBeside, type Walked, walked } from './walked.ts';

/**
 * An id names a cycle: on a schema that lies on none it is refused, beside any other failure. A
 * walk that refused a schema inside for its depth did not see all it reaches, so it does not judge.
 */
export function offCycle(state: State, entered: Entered, node: Walked): Walked {
  if (entered.id === undefined || isWalkedInPart(state, node)) {
    return node;
  }
  return refusedBeside(notAllowed(entered.at, refusedAcyclicId(entered.id)), node);
}

/**
 * A schema with an id on a cycle is its def, a `ref` at every use, or its failure; one with a
 * taken id is that refusal. A def is never nullable, since `.nullable()` belongs to a use.
 */
export function writeDef(state: State, entered: Entered, node: Walked): Walked {
  const written = writtenIdOf(entered.schema);
  if (written === undefined) {
    return isRemembered(state, entered.schema) ? withoutOutline(node) : node;
  }
  const ref: RefNode = { type: 'ref', name: written };
  if (node.kind === 'not-allowed') {
    return dropOpenGroup(state, entered, failed(node.tree, ref));
  }
  const owner = state.schemaById.get(written);
  if (owner !== undefined && owner !== entered.schema) {
    return rememberedAs(state, entered, notAllowed(entered.at, refusedDuplicateId(written)));
  }
  state.schemaById.set(written, entered.schema);
  if (leadsBackWithNoNode(written, node.value, state.defById)) {
    return dropOpenGroup(state, entered, notAllowed(entered.at, refused.nodelessCycle, ref));
  }
  if (node.value.nullable === true) {
    const refusal = notAllowed(entered.at, refusedNullableDef(written), ref);
    return dropOpenGroup(state, entered, refusal);
  }
  state.defById.set(written, node.value);
  return rememberedAs(state, entered, walked(ref));
}

function rememberedAs(state: State, entered: Entered, answer: Walked): Walked {
  state.remembered.remember(entered, answer);
  return answer;
}

/**
 * Remembers the one failure of a def, and gives it to the defs still open below it, which hold
 * `ref`s to it, so every use of any of them reports that failure; each keeps its group. A def
 * given a failure is no def any more, so a later failure higher up does not replace the first.
 */
function dropOpenGroup(state: State, entered: Entered, failure: Failed): Walked {
  state.remembered.remember(entered, failure);
  for (const member of state.open) {
    const name = defNameOf(member.answer);
    if (member.index > entered.index && name !== undefined) {
      state.defById.delete(name);
      state.remembered.remember(member, failure);
    }
  }
  return failure;
}

/** The name of the def a remembered answer is a `ref` to, none for a failure. */
function defNameOf(answer: Walked | undefined): string | undefined {
  return answer?.kind === 'walked' && answer.value.type === 'ref' ? answer.value.name : undefined;
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
  return node.kind === 'not-allowed' && state.remembered.holdsWrittenTooDeep(node.tree);
}
