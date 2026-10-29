import type * as core from 'zod/v4/core';
import type { Memos } from './memos.ts';
import type { SchemaNode } from './nodes.ts';
import type { Reported } from './reported.ts';
import type { ReachedSchema } from './walked.ts';

/** A schema the walk enters, where it sits and the id its own metadata gives it. */
export type Entering = ReachedSchema & { readonly id: string | undefined };

/** A schema being walked, numbered in walk order, with the lowest number it reaches back to. */
export type Ancestor = Entering & { readonly index: number; low: number; reached: boolean };

/** A def written while the group it belongs to is still being walked. */
export type OpenDef = {
  readonly schema: core.$ZodType;
  readonly index: number;
  readonly low: number;
};

/** What one walk knows of its cycles: the schemas on its path, its defs and the failures it keeps. */
export type State = {
  readonly ancestors: Ancestor[];
  readonly openDefs: OpenDef[];
  readonly nameBySchema: Map<core.$ZodType, string>;
  readonly schemaById: Map<string, core.$ZodType>;
  readonly defById: Map<string, SchemaNode>;
  readonly reported: Reported;
  readonly memos: Memos;
  count: number;
};

/** Whether the walk answers the schema from memory from now on: a def, or a failure kept for every use. */
export function isRemembered(state: State, schema: core.$ZodType): boolean {
  return state.nameBySchema.has(schema) || state.reported.failureOf(schema) !== undefined;
}
