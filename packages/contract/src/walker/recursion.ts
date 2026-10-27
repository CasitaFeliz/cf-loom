import type * as core from 'zod/v4/core';
import { leadsBackWithNoNode } from './children.ts';
import { type Memos, startMemos } from './memos.ts';
import type { NotAllowed, RefNode, SchemaNode } from './nodes.ts';
import {
  notAllowed,
  refused,
  refusedAcyclicId,
  refusedDuplicateId,
  refusedNullableDef,
} from './not-allowed.ts';
import { type Reported, startReported } from './reported.ts';
import {
  type Composition,
  type Failed,
  failed,
  failuresOf,
  type Memo,
  type ReachedSchema,
  refusedBeside,
  type Walked,
  walked,
} from './walked.ts';

/** A schema the walk enters, where it sits and the id its own metadata gives it. */
export type Entering = ReachedSchema & { readonly id: string | undefined };

/**
 * The cycles of one walk: a schema with an id lies on a cycle, and every such schema in a
 * strongly connected group of schemas is written once under `defs` and is a `ref` wherever it
 * is used, whichever schema the walk enters the group at.
 */
export type Recursion = {
  readonly within: (entering: Entering, walk: () => Walked) => Walked;
  readonly defs: () => Readonly<Record<string, SchemaNode>>;
  /** Each declaration walks afresh a cycle no id names, which has no identity to share, and what holds one. */
  readonly forgetUnnamedCycles: () => void;
  /** The remembered schema each refusal was raised inside, those of compositions included. */
  readonly memoOf: ReadonlyMap<NotAllowed, Memo>;
};

/** A schema being walked, numbered in walk order, with the lowest number it reaches back to. */
type Ancestor = Entering & { readonly index: number; low: number; reached: boolean };

/** A def written while the group it belongs to is still being walked. */
type OpenDef = { readonly schema: core.$ZodType; readonly index: number; readonly low: number };

type State = {
  readonly ancestors: Ancestor[];
  readonly openDefs: OpenDef[];
  readonly nameBySchema: Map<core.$ZodType, string>;
  readonly schemaById: Map<string, core.$ZodType>;
  readonly defById: Map<string, SchemaNode>;
  readonly reported: Reported;
  readonly memos: Memos;
  count: number;
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

function within(state: State, entering: Entering, walk: () => Walked): Walked {
  const known = refOf(state, entering) ?? reportedOf(state, entering) ?? metAgain(state, entering);
  if (known !== undefined) {
    return known;
  }
  const index = state.count++;
  const ancestor: Ancestor = { ...entering, index, low: index, reached: false };
  state.ancestors.push(ancestor);
  const start = state.memos.start();
  const node = walk();
  state.ancestors.pop();
  reachBack(state, ancestor.low);
  const isOnCycle = ancestor.reached || ancestor.low < ancestor.index;
  const result = isOnCycle ? writeDef(state, ancestor, node) : offCycle(ancestor, node);
  state.memos.raised(failuresOf([result]));
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
 * The schema met again inside itself: its `ref` if it has an id, a failure if no schema of the
 * cycle has one, else nothing, so the walk goes through it again up to one that has.
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
  if (entering.id !== undefined) {
    state.memos.reached(entering.schema, entering.at);
    return walked({ type: 'ref', name: entering.id });
  }
  if (cycle.some((member) => member.id !== undefined)) {
    return undefined;
  }
  const failure = notAllowed(entering.at, refused.unnamedCycle);
  for (const ancestor of cycle) {
    state.reported.report(ancestor.schema, failure);
  }
  state.memos.raised(failure.tree);
  state.memos.reached(entering.schema, entering.at);
  return failure;
}

function forgetUnnamedCycles(state: State): void {
  for (const schema of state.reported.forgetInDeclaration()) {
    state.memos.forget(schema);
  }
}

/** Whether the walk answers the schema from memory from now on: a def, or a failure kept for every use. */
function isRemembered(state: State, schema: core.$ZodType): boolean {
  return state.nameBySchema.has(schema) || state.reported.failureOf(schema) !== undefined;
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

/** An id names a cycle: on a schema that lies on none it is refused, beside any other failure. */
function offCycle(ancestor: Ancestor, node: Walked): Walked {
  if (ancestor.id === undefined) {
    return node;
  }
  return refusedBeside(notAllowed(ancestor.at, refusedAcyclicId(ancestor.id)), node);
}

/**
 * A schema with an id on a cycle is walked once: its def, or its failures, kept for every use,
 * each of which is a `ref` to it. A def is never nullable: `.nullable()` belongs to a use, so a
 * schema that admits `null` is refused as a def, through `z.lazy()` or an intersection included.
 */
function writeDef(state: State, ancestor: Ancestor, node: Walked): Walked {
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
