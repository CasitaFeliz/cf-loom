import { offCycle, writeDef } from './cycle-defs.ts';
import { startMemos } from './memos.ts';
import { droppedIdOf, hasOwnId, writtenIdOf } from './metadata.ts';
import type { NotAllowed, SchemaNode } from './nodes.ts';
import { notAllowed, type Refused, refused, refusedDroppedId } from './not-allowed.ts';
import {
  deepestOnPath,
  type Entered,
  type Entering,
  isRemembered,
  type State,
} from './recursion-state.ts';
import { startRemembered } from './remembered.ts';
import { type Composition, type Memo, type Walked, type Walking, walked } from './walked.ts';
import { writtenDepthOf, writtenNestingLimit } from './written-depth.ts';

/**
 * The cycles of one walk: a schema with an id lies on a cycle, and every such schema in a
 * strongly connected group of schemas is written once under `defs` and is a `ref` wherever it
 * is used, whichever schema the walk enters the group at. A schema with an id the walk accepts is
 * walked once, and one entered more than 256 schemas below its root, as written, is refused there.
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
    open: [],
    remembered: startRemembered(),
    schemaById: new Map(),
    defById: new Map(),
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
  const known = rememberedOf(state, entering) ?? metAgain(state, entering);
  if (known !== undefined) {
    return known;
  }
  const isTooDeep = writtenDepthOf(state.ancestors, entering.id) > writtenNestingLimit;
  const entered = enter(state, entering);
  const start = state.memos.start();
  const node = isTooDeep ? notAllowed(entering.at, refused.writtenTooDeep) : yield* walk();
  state.ancestors.pop();
  reachBack(state, entered.low);
  entered.isOnCycle ||= entered.isReached || entered.low < entered.index;
  const result = entered.isOnCycle
    ? writeDef(state, entered, node)
    : offCycle(state, entered, node);
  if (result.kind === 'not-allowed') {
    state.memos.raised(result.tree);
  }
  if (isRemembered(state, entered.schema)) {
    state.memos.close(entered, start);
  }
  closeGroup(state, entered);
  return result;
}

/** A schema entered on the path and in an open group, on a cycle if any earlier walk of it judged so. */
function enter(state: State, entering: Entering): Entered {
  const index = state.count++;
  const isOnCycle = state.remembered.enteredOf(entering.schema)?.isOnCycle === true;
  const entered: Entered = {
    ...entering,
    index,
    low: index,
    isReached: false,
    isOpen: true,
    isOnCycle,
    answer: undefined,
    depth: state.ancestors.length,
    outer: deepestOnPath(state, entering.schema),
  };
  state.remembered.enter(entered);
  state.ancestors.push(entered);
  state.open.push(entered);
  return entered;
}

/** The answer the walk remembers for a schema, which reaches back to its group while that is still open. */
function rememberedOf(state: State, entering: Entering): Walked | undefined {
  const entered = state.remembered.enteredOf(entering.schema);
  const answer = entered?.answer;
  if (entered === undefined || answer === undefined) {
    return undefined;
  }
  if (entered.isOpen) {
    reachBackTo(state, entered);
  }
  state.memos.reached(entering.schema, entering.at);
  return answer;
}

/**
 * The schema met again inside itself: its `ref` if it wrote an id, a failure if no schema of the
 * cycle wrote one, else nothing, so the walk goes on to one that has. An id the walk refuses
 * still names the cycle, whose schema then fails by that refusal alone. The schema is found by
 * its deepest entry on the walk's path.
 */
function metAgain(state: State, entering: Entering): Walked | undefined {
  const closing = deepestOnPath(state, entering.schema);
  if (closing === undefined) {
    return undefined;
  }
  reachBackTo(state, closing);
  const id = writtenIdOf(entering.schema);
  if (id !== undefined) {
    state.memos.reached(entering.schema, entering.at);
    return walked({ type: 'ref', name: id });
  }
  if (isNamedFrom(state, closing.depth)) {
    return undefined;
  }
  const cycle = state.ancestors.slice(closing.depth);
  const failure = notAllowed(entering.at, unnamedCycleRefusalOf(cycle));
  for (const ancestor of cycle) {
    state.remembered.remember(ancestor, failure);
  }
  state.memos.raised(failure.tree);
  state.memos.reached(entering.schema, entering.at);
  return failure;
}

/** Whether a schema on the path from `depth` on wrote an id, found without copying the path. */
function isNamedFrom(state: State, depth: number): boolean {
  for (let index = depth; index < state.ancestors.length; index++) {
    const member = state.ancestors[index];
    if (member !== undefined && hasOwnId(member.schema)) {
      return true;
    }
  }
  return false;
}

/** A cycle no id names is refused, naming the id a later call dropped from one of its schemas. */
function unnamedCycleRefusalOf(cycle: readonly Entered[]): Refused {
  for (const member of cycle) {
    const dropped = droppedIdOf(member.schema);
    if (dropped !== undefined) {
      return refusedDroppedId(dropped);
    }
  }
  return refused.unnamedCycle;
}

function forgetUnnamedCycles(state: State): void {
  for (const schema of state.remembered.forgetInDeclaration()) {
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

/** The schema being walked now reaches back to one whose group is still open. */
function reachBackTo(state: State, reached: Entered): void {
  reached.isReached = true;
  reachBack(state, reached.index);
}

/** A schema that reaches back to nothing above it closes its group: every schema entered since it. */
function closeGroup(state: State, entered: Entered): void {
  if (entered.low !== entered.index) {
    return;
  }
  for (let member = state.open.pop(); member !== undefined; member = state.open.pop()) {
    member.isOpen = false;
    if (member === entered) {
      return;
    }
  }
}
