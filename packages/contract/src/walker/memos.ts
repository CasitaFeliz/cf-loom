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

/** Where the walk's records stood when a schema was entered: what comes after was raised inside it. */
export type Start = {
  readonly raised: number;
  readonly compositions: number;
  readonly reaches: number;
};

/**
 * What the walk records of the schemas it answers from memory: every place each is reached, and
 * which of them each refusal and composition was raised inside, so the fold tells each at the
 * places that schema is reached.
 */
export type Memos = {
  /** A remembered schema reached at a place, its first entry aside. */
  readonly reached: (schema: core.$ZodType, at: Reached) => void;
  /** Refusals the walk returns, the first time each is returned being where it was raised. */
  readonly raised: (tree: FailureTree) => void;
  readonly start: () => Start;
  /** A remembered schema's walk closed: it claims what was raised and reached during it, since `start`. */
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
  readonly raised: NotAllowed[];
  readonly logged: Set<NotAllowed | FailureTree>;
  readonly reaches: Reach[];
  readonly compositions: readonly Composition[];
};

/** The records of one walk, which reads the compositions it builds as they grow. */
export function startMemos(compositions: readonly Composition[]): Memos {
  const state: State = {
    memoBySchema: new Map(),
    earlyReaches: new Map(),
    memoOf: new Map(),
    raised: [],
    logged: new Set(),
    reaches: [],
    compositions,
  };
  return {
    reached: (schema, at) => reached(state, schema, at),
    raised: (tree) => logRaised(state, tree),
    start: () => ({
      raised: state.raised.length,
      compositions: compositions.length,
      reaches: state.reaches.length,
    }),
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
 * A remembered schema's memo is made where its walk entered it; it keeps what was raised during
 * that walk that no schema inside it already keeps, and the reaches made during it; then its own
 * entry is one reach of it, for the schema around it.
 */
function close(state: State, closed: ReachedSchema, start: Start): void {
  const memo: Memo = { at: closed.at, reaches: state.earlyReaches.get(closed.schema) ?? [] };
  state.memoBySchema.set(closed.schema, memo);
  state.earlyReaches.delete(closed.schema);
  const built = state.compositions.slice(start.compositions).map(({ refusal }) => refusal);
  for (const refusal of [...state.raised.slice(start.raised), ...built]) {
    if (!state.memoOf.has(refusal)) {
      state.memoOf.set(refusal, memo);
    }
  }
  for (const reach of state.reaches.slice(start.reaches)) {
    if (reach.within === undefined) {
      reach.within = memo;
    }
  }
  reached(state, closed.schema, closed.at);
}
