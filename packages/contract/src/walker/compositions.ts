import type * as core from 'zod/v4/core';
import { movedFrom } from './location.ts';
import type { Composition, ReachedSchema } from './walked.ts';

/** The compositions the walk of a schema built, and where it was first entered. */
type Recorded = Pick<ReachedSchema, 'at'> & { readonly compositions: readonly Composition[] };

/**
 * The `allOf` and `union` nodes a walk builds, in order, and what the walk of each schema it may
 * meet again built, so a later reach answered from memory adds them again at its own place.
 */
export type Compositions = {
  readonly built: Composition[];
  readonly bySchema: Map<core.$ZodType, Recorded>;
};

/** The compositions of a walk, starting from the list the walk adds to. */
export function startCompositions(built: Composition[]): Compositions {
  return { built, bySchema: new Map() };
}

/** Adds the compositions built inside a schema again, at the place it is entered now. */
export function replayed({ built, bySchema }: Compositions, entering: ReachedSchema): void {
  const recorded = bySchema.get(entering.schema);
  for (const { at, node } of recorded?.compositions ?? []) {
    built.push({ at: movedFrom(at, recorded?.at ?? at, entering.at), node });
  }
}

/** Keeps what the walk of a schema built, since a later reach of it will be answered from memory. */
export function kept(
  { bySchema }: Compositions,
  entered: ReachedSchema,
  compositions: readonly Composition[],
): void {
  bySchema.set(entered.schema, { at: entered.at, compositions });
}
