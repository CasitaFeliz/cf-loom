import type * as core from 'zod/v4/core';
import type { NotAllowed } from './nodes.ts';
import type { Composition, Memo, Reach, Reached, ReachedSchema } from './walked.ts';

/** Where the walk's records stood when a schema was entered: what comes after was raised inside it. */
export type Start = { readonly compositions: number; readonly reaches: number };

/**
 * What the walk records of the schemas it answers from memory: every place each is reached, and
 * which of them each refusal and composition was raised inside, so the fold tells each at the
 * places that schema is reached.
 */
export type Memos = {
  /** A remembered schema reached at a place; `entered` is where it was first entered. */
  readonly reached: (entered: ReachedSchema, at: Reached) => void;
  readonly start: () => Start;
  /** A remembered schema's walk closed: it claims what was raised and reached inside it since `start`. */
  readonly close: (closed: ReachedSchema, raised: readonly NotAllowed[], start: Start) => void;
  readonly memoOf: ReadonlyMap<NotAllowed, Memo>;
};

type State = {
  readonly memoBySchema: Map<core.$ZodType, Memo>;
  readonly memoOf: Map<NotAllowed, Memo>;
  readonly reaches: Reach[];
  readonly compositions: readonly Composition[];
};

/** The records of one walk, which reads the compositions it builds as they grow. */
export function startMemos(compositions: readonly Composition[]): Memos {
  const state: State = { memoBySchema: new Map(), memoOf: new Map(), reaches: [], compositions };
  return {
    reached: (entered, at) => reached(state, entered, at),
    start: () => ({ compositions: compositions.length, reaches: state.reaches.length }),
    close: (closed, raised, start) => close(state, closed, { raised, start }),
    memoOf: state.memoOf,
  };
}

/** The memo of a remembered schema, made where it was first entered. */
function memoFor(state: State, { schema, at }: ReachedSchema): Memo {
  const known = state.memoBySchema.get(schema);
  if (known !== undefined) {
    return known;
  }
  const memo: Memo = { at, reaches: [] };
  state.memoBySchema.set(schema, memo);
  return memo;
}

/** A reach of a remembered schema, which the memo whose walk it is made in claims when that closes. */
function reached(state: State, entered: ReachedSchema, at: Reached): void {
  const reach: Reach = { at, within: undefined };
  memoFor(state, entered).reaches.push(reach);
  state.reaches.push(reach);
}

/**
 * A remembered schema keeps what its walk raised that no schema inside it already keeps, and
 * the reaches made inside it; then its own entry is one reach of it, for the schema around it.
 */
function close(
  state: State,
  closed: ReachedSchema,
  { raised, start }: { readonly raised: readonly NotAllowed[]; readonly start: Start },
): void {
  const memo = memoFor(state, closed);
  const built = state.compositions.slice(start.compositions).map(({ refusal }) => refusal);
  for (const refusal of [...raised, ...built]) {
    if (!state.memoOf.has(refusal)) {
      state.memoOf.set(refusal, memo);
    }
  }
  for (const reach of state.reaches.slice(start.reaches)) {
    if (reach.within === undefined) {
      reach.within = memo;
    }
  }
  reached(state, closed, closed.at);
}
