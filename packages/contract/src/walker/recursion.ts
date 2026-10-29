import { offCycle, writeDef } from './cycle-defs.ts';
import { startMemos } from './memos.ts';
import { droppedIdOf, hasOwnId, writtenIdOf } from './metadata.ts';
import type { NotAllowed, SchemaNode } from './nodes.ts';
import { notAllowed, type Refused, refused, refusedDroppedId } from './not-allowed.ts';
import { type Ancestor, type Entering, isRemembered, type State } from './recursion-state.ts';
import { startReported } from './reported.ts';
import { type Composition, type Memo, type Walked, type Walking, walked } from './walked.ts';
import { writtenDepthOf, writtenNestingLimit } from './written-depth.ts';

/**
 * The cycles of one walk: a schema with an id lies on a cycle, and every such schema in a
 * strongly connected group of schemas is written once under `defs` and is a `ref` wherever it
 * is used, whichever schema the walk enters the group at. A schema entered more than 256 schemas
 * below its root, as written, is refused there and not entered.
 */
export type Recursion = {
  readonly within: (entering: Entering, walk: () => Walking) => Walking;
  readonly defs: () => Readonly<Record<string, SchemaNode>>;
  /** Each declaration walks afresh a cycle no id names, which has no identity to share, and what holds one. */
  readonly forgetUnnamedCycles: () => void;
  /** The remembered schema each refusal was raised inside, those of compositions included. */
  readonly memoOf: ReadonlyMap<NotAllowed, Memo>;
};

/** The recursion state shared by every schema of one Snapshot, so ids are unique across it. */
export function startRecursion(compositions: readonly Composition[]): Recursion {
  const state: State = {
    ancestors: [],
    openDefs: [],
    nameBySchema: new Map(),
    schemaById: new Map(),
    defById: new Map(),
    reported: startReported(),
    memos: startMemos(compositions),
    count: 0,
  };
  return {
    within: (entering, walk) => within(state, entering, walk),
    defs: () => Object.fromEntries(state.defById),
    forgetUnnamedCycles: () => forgetUnnamedCycles(state),
    memoOf: state.memos.memoOf,
  };
}

function* within(state: State, entering: Entering, walk: () => Walking): Walking {
  const known = refOf(state, entering) ?? reportedOf(state, entering) ?? metAgain(state, entering);
  if (known !== undefined) {
    return known;
  }
  const isTooDeep = writtenDepthOf(state.ancestors, entering.id) > writtenNestingLimit;
  const index = state.count++;
  const ancestor: Ancestor = { ...entering, index, low: index, reached: false };
  state.ancestors.push(ancestor);
  const start = state.memos.start();
  const node = isTooDeep ? notAllowed(entering.at, refused.writtenTooDeep) : yield* walk();
  state.ancestors.pop();
  reachBack(state, ancestor.low);
  const isOnCycle = ancestor.reached || ancestor.low < ancestor.index;
  const result = isOnCycle ? writeDef(state, ancestor, node) : offCycle(state, ancestor, node);
  if (result.kind === 'not-allowed') {
    state.memos.raised(result.tree);
  }
  if (isRemembered(state, ancestor.schema)) {
    state.memos.close(ancestor, start);
  }
  closeGroup(state, ancestor);
  return result;
}

/** The `ref` of a schema already written, which joins its group when that is still open. */
function refOf(state: State, entering: Entering): Walked | undefined {
  const name = state.nameBySchema.get(entering.schema);
  if (name === undefined) {
    return undefined;
  }
  const open = state.openDefs.find((def) => def.schema === entering.schema);
  if (open !== undefined) {
    reachBack(state, open.low);
  }
  state.memos.reached(entering.schema, entering.at);
  return walked({ type: 'ref', name });
}

/** The failure already reported for a cycle the schema lies on, as walked: the fold tells it at each place. */
function reportedOf(state: State, entering: Entering): Walked | undefined {
  const failure = state.reported.failureOf(entering.schema);
  if (failure === undefined) {
    return undefined;
  }
  state.memos.reached(entering.schema, entering.at);
  return failure;
}

/**
 * The schema met again inside itself: its `ref` if it wrote an id, a failure if no schema of the
 * cycle wrote one, else nothing, so the walk goes through it again up to one that has. An id the
 * walk refuses names the cycle all the same: the schema's own walk fails by that refusal alone,
 * so its `ref` is never written.
 */
function metAgain(state: State, entering: Entering): Walked | undefined {
  const closingIndex = state.ancestors.findLastIndex(
    (ancestor) => ancestor.schema === entering.schema,
  );
  const closing = state.ancestors[closingIndex];
  if (closing === undefined) {
    return undefined;
  }
  closing.reached = true;
  reachBack(state, closing.index);
  const cycle = state.ancestors.slice(closingIndex);
  const id = writtenIdOf(entering.schema);
  if (id !== undefined) {
    state.memos.reached(entering.schema, entering.at);
    return walked({ type: 'ref', name: id });
  }
  if (cycle.some((member) => hasOwnId(member.schema))) {
    return undefined;
  }
  const failure = notAllowed(entering.at, unnamedCycleRefusalOf(cycle));
  for (const ancestor of cycle) {
    state.reported.report(ancestor.schema, failure);
  }
  state.memos.raised(failure.tree);
  state.memos.reached(entering.schema, entering.at);
  return failure;
}

/** A cycle no id names is refused, naming the id a later call dropped from one of its schemas. */
function unnamedCycleRefusalOf(cycle: readonly Ancestor[]): Refused {
  for (const member of cycle) {
    const dropped = droppedIdOf(member.schema);
    if (dropped !== undefined) {
      return refusedDroppedId(dropped);
    }
  }
  return refused.unnamedCycle;
}

function forgetUnnamedCycles(state: State): void {
  for (const schema of state.reported.forgetInDeclaration()) {
    state.memos.forget(schema);
  }
}

/** The schema being walked now reaches back to the one numbered `low`, or lower. */
function reachBack(state: State, low: number): void {
  const current = state.ancestors.at(-1);
  if (current !== undefined) {
    current.low = Math.min(current.low, low);
  }
}

/** A schema that reaches back to nothing above it closes its group: no def of it stays open. */
function closeGroup(state: State, ancestor: Ancestor): void {
  if (ancestor.low !== ancestor.index) {
    return;
  }
  const remaining = state.openDefs.filter((def) => def.index < ancestor.index);
  state.openDefs.splice(0, state.openDefs.length, ...remaining);
}
