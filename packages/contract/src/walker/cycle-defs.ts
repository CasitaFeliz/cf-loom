import { idRefusalOf, writtenIdOf } from './metadata.ts';
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
  failuresOf,
  isWhole,
  type JudgedDefs,
  type Outline,
  outlineOf,
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
 * taken id is that refusal. A def is never nullable, since `.nullable()` belongs to a use. A def
 * that fails keeps the outline it was building, which the rules over defs judge.
 */
export function writeDef(state: State, entered: Entered, node: Walked): Walked {
  const written = writtenIdOf(entered.schema);
  if (written === undefined) {
    return isRemembered(state, entered.schema) ? withoutOutline(node) : node;
  }
  const ref: RefNode = { type: 'ref', name: written };
  const nullable = nullableDefRefusalsOf(entered, written, node);
  const owner = state.schemaById.get(written);
  if (owner !== undefined && owner !== entered.schema) {
    return duplicateDef(state, entered, { node, nullable, ref });
  }
  state.schemaById.set(written, entered.schema);
  entered.def = outlineOf(node);
  if (node.kind === 'not-allowed' || nullable.length > 0) {
    return dropOpenGroup(state, entered, failed(failuresOf([...nullable, node]), ref));
  }
  return rememberedAs(state, entered, walked(ref));
}

/** The refusal of a def that admits null, which `.nullable()` on each use would not. */
function nullableDefRefusalsOf(entered: Entered, id: string, node: Walked): readonly Failed[] {
  return outlineOf(node).nullable === true ? [notAllowed(entered.at, refusedNullableDef(id))] : [];
}

/** A schema with an id another schema wrote, which is told beside what its own walk refused. */
type Duplicate = {
  readonly node: Walked;
  readonly nullable: readonly Failed[];
  readonly ref: RefNode;
};

/**
 * A second schema with an id is that refusal, built nothing; an id the walk refuses is renamed by
 * its fix, so it is no duplicate and the schema fails as any def does.
 */
function duplicateDef(state: State, entered: Entered, { node, nullable, ref }: Duplicate): Walked {
  if (idRefusalOf(ref.name) !== undefined) {
    return dropOpenGroup(state, entered, failed(failuresOf([...nullable, node]), ref));
  }
  const duplicate = notAllowed(entered.at, refusedDuplicateId(ref.name));
  return rememberedAs(state, entered, failed(failuresOf([...nullable, duplicate, node])));
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
  const name = defNameOf(member.answer);
  if (name !== undefined) {
    state.remembered.remember(member, failed(failure.tree, { type: 'ref', name }));
  }
}

/** The name of the def a remembered answer is a `ref` to, none for a failure. */
function defNameOf(answer: Walked | undefined): string | undefined {
  return answer?.kind === 'walked' ? refNameOf(answer.value) : undefined;
}

/**
 * A schema on a cycle no id names is `Unbuilt` wherever it is used, met again or ended: its fix, an
 * id, makes it a `ref`, which no check or rule reads through.
 */
function withoutOutline(node: Walked): Walked {
  return node.kind === 'not-allowed' ? failed(node.tree) : node;
}

function isWalkedInPart(state: State, node: Walked): boolean {
  return node.kind === 'not-allowed' && state.remembered.holdsWrittenTooDeep(node.tree);
}

/** A def the walk wrote, by the id it wrote, with the entry that wrote it. */
type WrittenDef = { readonly name: string; readonly entered: Entered; readonly def: Outline };

/** A def written whole that no failure took the place of. */
type StandingDef = WrittenDef & { readonly def: SchemaNode };

/** Every def the walk wrote or was writing, a def that failed or was failed included, in the order written. */
function judgedEntriesOf(state: State): readonly WrittenDef[] {
  const entries: WrittenDef[] = [];
  for (const [name, schema] of state.schemaById) {
    const entered = state.remembered.enteredOf(schema);
    if (entered?.def !== undefined) {
      entries.push({ name, entered, def: entered.def });
    }
  }
  return entries;
}

function isStanding(written: WrittenDef): written is StandingDef {
  return isWhole(written.def) && defNameOf(written.entered.answer) !== undefined;
}

/** Every def the walk wrote or was writing, by its id: what the rules over defs judge. */
export function judgedDefsOf(state: State): JudgedDefs {
  return Object.fromEntries(judgedEntriesOf(state).map(({ name, def }) => [name, def]));
}

/** Every judged def that was written whole and that no failure took the place of, in the order written. */
export function defsOf(state: State): Readonly<Record<string, SchemaNode>> {
  const standing = judgedEntriesOf(state).filter(isStanding);
  return Object.fromEntries(standing.map(({ name, def }) => [name, def]));
}

/**
 * A group of schemas closing: each nodeless cycle among the defs it wrote, a def that failed or
 * was failed included, is refused once, at its def the walk entered first, and the group fails
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
