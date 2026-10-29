import type * as core from 'zod/v4/core';
import type { Memos } from './memos.ts';
import type { SchemaNode } from './nodes.ts';
import type { Remembered } from './remembered.ts';
import type { ReachedSchema, Walked } from './walked.ts';

/** A schema the walk enters, where it sits and the id its own metadata gives it. */
export type Entering = ReachedSchema & { readonly id: string | undefined };

/**
 * A schema the walk entered: its place in the search for strongly connected groups and, once
 * judged, its verdict on a cycle and its answer from memory.
 */
export type Entered = Entering & {
  readonly index: number;
  low: number;
  isReached: boolean;
  /** While its group is still being walked, a schema that reaches it reaches that group. */
  isOpen: boolean;
  isOnCycle: boolean;
  answer: Walked | undefined;
};

/** What one walk knows of its cycles: the schemas on its path and in open groups, its defs and what it remembers. */
export type State = {
  readonly ancestors: Entered[];
  /** Every schema entered whose group is still open, in walk order. */
  readonly open: Entered[];
  readonly remembered: Remembered;
  readonly schemaById: Map<string, core.$ZodType>;
  readonly defById: Map<string, SchemaNode>;
  readonly memos: Memos;
  count: number;
};

/** Whether the walk answers the schema from memory from now on: a def, or a failure kept for its uses. */
export function isRemembered(state: State, schema: core.$ZodType): boolean {
  return state.remembered.enteredOf(schema)?.answer !== undefined;
}
