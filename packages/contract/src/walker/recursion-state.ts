import type * as core from 'zod/v4/core';
import type { Memos } from './memos.ts';
import type { SchemaNode } from './nodes.ts';
import type { Remembered } from './remembered.ts';
import type { ReachedSchema, Walked } from './walked.ts';

/** A schema the walk enters, where it sits and the id its own metadata gives it. */
export type Entering = ReachedSchema & { readonly id: string | undefined };

/**
 * A schema the walk entered, numbered in walk order, with the lowest number it reaches back to,
 * whether a schema reached it back, and whether the strongly connected group it belongs to is
 * still being walked: until then, a schema that reaches it reaches that group. Whether the walk
 * judged it on a cycle, and what it answers it with from memory while it does.
 */
export type Entered = Entering & {
  readonly index: number;
  low: number;
  reached: boolean;
  open: boolean;
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
