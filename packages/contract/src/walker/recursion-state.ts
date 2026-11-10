import type * as core from 'zod/v4/core';
import type { Memos } from './memos.ts';
import type { Remembered } from './remembered.ts';
import type { Outline, ReachedSchema, Walked } from './walked.ts';

/** A schema the walk enters, where it sits and the id its own metadata gives it. */
export type Entering = ReachedSchema & { readonly id: string | undefined };

/**
 * A schema the walk entered: its place in the search for strongly connected groups and, once
 * judged, its verdict on a cycle and its answer from memory.
 */
export type Entered = Entering & {
  readonly index: number;
  /** Its index in `ancestors` while it is on the walk's path. */
  readonly depth: number;
  /** The same schema's deepest entry on the path when this one was entered, if the schema was on it. */
  readonly outer: Entered | undefined;
  /** Its position in `open` while its group is open. */
  readonly slot: number;
  low: number;
  isReached: boolean;
  /** While its group is still being walked, a schema that reaches it reaches that group. */
  isOpen: boolean;
  isOnCycle: boolean;
  answer: Walked | undefined;
  /** The def it wrote, as the outline it was built as, kept once a failure takes the def's place, so the rules over defs still judge it. */
  def: Outline | undefined;
  /**
   * Once it failed as a def, the end of `open` at that moment: every member between its slot and
   * here is no def any more, so a later failure passes over them.
   */
  droppedThrough: number | undefined;
};

/** What one walk knows of its cycles: the schemas on its path and in open groups, its defs and what it remembers. */
export type State = {
  readonly ancestors: Entered[];
  /** Every schema entered whose group is still open, in walk order. */
  readonly open: Entered[];
  readonly remembered: Remembered;
  readonly schemaById: Map<string, core.$ZodType>;
  readonly memos: Memos;
  count: number;
};

/** Whether the walk answers the schema from memory from now on: a def, or a failure kept for its uses. */
export function isRemembered(state: State, schema: core.$ZodType): boolean {
  return state.remembered.enteredOf(schema)?.answer !== undefined;
}

/**
 * The deepest entry of a schema on the walk's path: its last entry, or the entry that one was
 * entered inside, whichever `ancestors` still holds at its depth.
 */
export function deepestEntryOf(state: State, schema: core.$ZodType): Entered | undefined {
  for (let entry = state.remembered.enteredOf(schema); entry !== undefined; entry = entry.outer) {
    if (state.ancestors[entry.depth] === entry) {
      return entry;
    }
  }
  return undefined;
}
