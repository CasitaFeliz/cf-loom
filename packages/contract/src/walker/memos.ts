import type * as core from 'zod/v4/core';
import type { NotAllowed } from './nodes.ts';
import {
  type Composition,
  type FailureTree,
  type Memo,
  type Reach,
  type Reached,
  type ReachedSchema,
  refusalsIn,
} from './walked.ts';

/**
 * Where the walk's records stood when a schema was entered: what is above it and unclaimed when
 * the schema closes was raised or reached inside it.
 */
export type Start = { readonly raised: number; readonly reaches: number };

/**
 * What the walk records of the schemas it answers from memory: every place each is reached, and
 * which of them each refusal and composition was raised inside, so the fold tells each at the
 * places that schema is reached; each is claimed once, by the innermost remembered schema whose
 * walk it was raised or reached in.
 */
export type Memos = {
  /** A remembered schema reached at a place, its first entry aside. */
  readonly reached: (schema: core.$ZodType, at: Reached) => void;
  /** Refusals the walk returns, the first time each is returned being where it was raised. */
  readonly raised: (tree: FailureTree) => void;
  /** An `allOf` or a `union` node the walk built, whose refusal joins those no remembered schema has claimed. */
  readonly built: (composition: Composition) => void;
  /**
   * Refusals of a remembered schema itself, judged after its walk closed: its memo claims them,
   * as it claims what its walk raised.
   */
  readonly raisedIn: (schema: core.$ZodType, tree: FailureTree) => void;
  readonly start: () => Start;
  /** A remembered schema's walk closed: it claims what was raised and reached during it that no schema inside it claimed. */
  readonly close: (closed: ReachedSchema, start: Start) => void;
  /** A schema walked afresh from now on: later reaches of it belong to its next walk. */
  readonly forget: (schema: core.$ZodType) => void;
  readonly memoOf: ReadonlyMap<NotAllowed, Memo>;
};

type State = {
  readonly memoBySchema: Map<core.$ZodType, Memo>;
  /** The reaches of a schema whose walk has not closed yet, which its memo takes when it does. */
  readonly earlyReaches: Map<core.$ZodType, Reach[]>;
  readonly memoOf: Map<NotAllowed, Memo>;
  /** The refusals and compositions no remembered schema has claimed yet, the latest on top. */
  readonly raised: NotAllowed[];
  readonly logged: Set<NotAllowed | FailureTree>;
  /** The reaches no remembered schema has claimed yet, the latest on top. */
  readonly reaches: Reach[];
};

/** The records of one walk. */
export function startMemos(): Memos {
  const state: State = {
    memoBySchema: new Map(),
    earlyReaches: new Map(),
    memoOf: new Map(),
    raised: [],
    logged: new Set(),
    reaches: [],
  };
  return {
    reached: (schema, at) => reached(state, schema, at),
    raised: (tree) => logRaised(state, tree),
    built: ({ refusal }) => {
      state.raised.push(refusal);
    },
    raisedIn: (schema, tree) => raisedIn(state, schema, tree),
    start: () => ({ raised: state.raised.length, reaches: state.reaches.length }),
    close: (closed, start) => close(state, closed, start),
    forget: (schema) => {
      state.memoBySchema.delete(schema);
      state.earlyReaches.delete(schema);
    },
    memoOf: state.memoOf,
  };
}

/** A reach of a remembered schema, which the memo whose walk it is made in claims when that closes. */
function reached(state: State, schema: core.$ZodType, at: Reached): void {
  const reach: Reach = { at, within: undefined };
  const reaches = state.memoBySchema.get(schema)?.reaches ?? earlyReachesOf(state, schema);
  reaches.push(reach);
  state.reaches.push(reach);
}

function raisedIn(state: State, schema: core.$ZodType, tree: FailureTree): void {
  const memo = state.memoBySchema.get(schema);
  if (memo === undefined) {
    throw new Error(
      'A refusal raised in a schema whose walk has not closed has no memo to claim it.',
    );
  }
  for (const refusal of refusalsIn(tree, state.logged)) {
    state.memoOf.set(refusal, memo);
  }
}

function earlyReachesOf(state: State, schema: core.$ZodType): Reach[] {
  const known = state.earlyReaches.get(schema) ?? [];
  state.earlyReaches.set(schema, known);
  return known;
}

function logRaised(state: State, tree: FailureTree): void {
  for (const refusal of refusalsIn(tree, state.logged)) {
    state.raised.push(refusal);
  }
}

/**
 * A remembered schema's memo is made where its walk entered it; it claims what was raised during
 * that walk and the reaches made during it that no schema inside it claimed, then its own entry
 * is one reach of it, for the schema around it.
 */
function close(state: State, closed: ReachedSchema, start: Start): void {
  const memo: Memo = { at: closed.at, reaches: state.earlyReaches.get(closed.schema) ?? [] };
  state.memoBySchema.set(closed.schema, memo);
  state.earlyReaches.delete(closed.schema);
  for (const refusal of state.raised.splice(start.raised)) {
    state.memoOf.set(refusal, memo);
  }
  for (const reach of state.reaches.splice(start.reaches)) {
    reach.within = memo;
  }
  reached(state, closed.schema, closed.at);
}
