import { writtenIdOf } from './metadata.ts';
import { nodelessCyclesOf } from './nodeless-cycles.ts';
import { type RefNode, refNameOf, type SchemaNode } from './nodes.ts';
import {
  notAllowed,
  refused,
  refusedAcyclicId,
  refusedDuplicateId,
  refusedNullableDef,
} from './not-allowed.ts';
import { type Entered, isRemembered, type State } from './recursion-state.ts';
import {
  type Failed,
  type FailureTree,
  failed,
  refusedBeside,
  type Walked,
  walked,
} from './walked.ts';

/**
 * An id names a cycle, so on a schema that lies on none it is refused, unless the walk refused a
 * schema inside for its depth and did not see all it reaches. Off a cycle, the failure does not
 * depend on where the schema is met, so it answers every later use.
 */
export function offCycle(state: State, entered: Entered, node: Walked): Walked {
  if (entered.id === undefined) {
    return node;
  }
  const failure = isWalkedInPart(state, node)
    ? node
    : refusedBeside(notAllowed(entered.at, refusedAcyclicId(entered.id)), node);
  state.remembered.remember(entered, failure);
  return failure;
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
  if (node.value.nullable === true) {
    const refusal = notAllowed(entered.at, refusedNullableDef(written), ref);
    return dropOpenGroup(state, entered, refusal);
  }
  entered.def = node.value;
  return rememberedAs(state, entered, walked(ref));
}

function rememberedAs(state: State, entered: Entered, answer: Walked): Walked {
  state.remembered.remember(entered, answer);
  return answer;
}

/**
 * Remembers the one failure of a def, and gives it to the defs still open below it, which hold
 * `ref`s to it, so every use of any of them reports that failure; each keeps its group.
 */
function dropOpenGroup(state: State, entered: Entered, failure: Failed): Walked {
  state.remembered.remember(entered, failure);
  failOpenMembers(state, entered.slot + 1, failure);
  entered.droppedThrough = state.open.length;
  return failure;
}

/**
 * Gives a failure to the defs still open from a slot on, which hold `ref`s to what failed, so
 * every use of any of them reports it. A def given a failure is no def any more, so a later
 * failure higher up does not replace the first, and it passes over the members that failed.
 */
function failOpenMembers(state: State, fromSlot: number, failure: Failed): void {
  let slot = fromSlot;
  for (let member = state.open[slot]; member !== undefined; member = state.open[slot]) {
    if (member.droppedThrough !== undefined) {
      slot = member.droppedThrough;
      continue;
    }
    giveFailure(state, member, failure);
    slot++;
  }
}

/** A def still open takes the failure of one that fails inside its group, so its `ref`s report it. */
function giveFailure(state: State, member: Entered, failure: Failed): void {
  if (defNameOf(member.answer) !== undefined) {
    state.remembered.remember(member, failure);
  }
}

/** The name of the def a remembered answer is a `ref` to, none for a failure. */
function defNameOf(answer: Walked | undefined): string | undefined {
  return answer?.kind === 'walked' ? refNameOf(answer.value) : undefined;
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

/** Every def the walk wrote that no failure took the place of, in the order written. */
export function defsOf(state: State): Readonly<Record<string, SchemaNode>> {
  const defs: [string, SchemaNode][] = [];
  for (const [name, schema] of state.schemaById) {
    const entered = state.remembered.enteredOf(schema);
    if (entered?.def !== undefined && defNameOf(entered.answer) !== undefined) {
      defs.push([name, entered.def]);
    }
  }
  return Object.fromEntries(defs);
}

/** A def the walk wrote, by the id it wrote, with the entry that wrote it. */
type WrittenDef = { readonly name: string; readonly entered: Entered; readonly def: SchemaNode };

/**
 * A group of schemas closing: each nodeless cycle among the defs it wrote, a def a failure took
 * the place of included, is refused once, at its def the walk entered first, and the group fails
 * with them beside its root's own refusals. Read once per group, so the walk reads each def once.
 */
export function refuseNodelessCycles(state: State, root: Entered, result: Walked): Walked {
  const written = writtenDefsOf(state, root.slot);
  const cycles = nodelessCyclesOf(Object.fromEntries(written.map(({ name, def }) => [name, def])));
  if (cycles.length === 0) {
    return result;
  }
  const cycleOf = new Map<string, readonly string[]>();
  for (const names of cycles) {
    for (const name of names) {
      cycleOf.set(name, names);
    }
  }
  const told = new Set<readonly string[]>();
  const refusals: FailureTree[] = [];
  for (const writtenDef of written) {
    const cycle = cycleOf.get(writtenDef.name);
    if (cycle !== undefined && !told.has(cycle)) {
      told.add(cycle);
      refusals.push(refuseCycleAt(state, writtenDef));
    }
  }
  const failure = refusedBeside(failed(refusals), result);
  failOpenMembers(state, root.slot, failure);
  return failure;
}

/** The defs written by the open group from a slot on, in the order the walk entered them. */
function writtenDefsOf(state: State, fromSlot: number): readonly WrittenDef[] {
  const written: WrittenDef[] = [];
  for (const entered of state.open.slice(fromSlot)) {
    const name = writtenIdOf(entered.schema);
    if (name !== undefined && entered.def !== undefined) {
      written.push({ name, entered, def: entered.def });
    }
  }
  return written;
}

/** The refusal of a nodeless cycle at its def, which that def's own memo claims. */
function refuseCycleAt(state: State, { name, entered }: WrittenDef): FailureTree {
  const refusal = notAllowed(entered.at, refused.nodelessCycle, { type: 'ref', name });
  state.memos.raisedIn(entered.schema, refusal.tree);
  return refusal.tree;
}
