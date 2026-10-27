import type * as core from 'zod/v4/core';
import { isUnnamedCycle } from './not-allowed.ts';
import { type Failed, type FailureTree, isFailureTree } from './walked.ts';

/** The failing schemas a walk answers from memory, and for how long each is kept. */
export type Reported = {
  readonly report: (schema: core.$ZodType, failure: Failed) => void;
  readonly failureOf: (schema: core.$ZodType) => Failed | undefined;
  /** Forgets the failures each declaration walks afresh, and returns their schemas. */
  readonly forgetInDeclaration: () => readonly core.$ZodType[];
};

type State = {
  readonly reportedBySchema: Map<core.$ZodType, Failed>;
  readonly reportedInDeclaration: Map<core.$ZodType, Failed>;
  readonly unnamedCycleIn: Map<FailureTree, boolean>;
};

/** The failures of one walk, which tells a failure that holds a cycle no id names once, when it is reported. */
export function startReported(): Reported {
  const state: State = {
    reportedBySchema: new Map(),
    reportedInDeclaration: new Map(),
    unnamedCycleIn: new Map(),
  };
  return {
    report: (schema, failure) => report(state, schema, failure),
    failureOf: (schema) =>
      state.reportedBySchema.get(schema) ?? state.reportedInDeclaration.get(schema),
    forgetInDeclaration: () => forgetInDeclaration(state),
  };
}

/**
 * A failure is kept for the walk, or for the declaration when it holds a cycle no id names, which
 * each declaration walks afresh. A schema is reported into one of them only: a cycle no id names
 * reports schemas without an id, and a def that fails has one.
 */
function report(state: State, schema: core.$ZodType, failure: Failed): void {
  const kept = holdsUnnamedCycle(state, failure.tree)
    ? state.reportedInDeclaration
    : state.reportedBySchema;
  kept.set(schema, failure);
}

function forgetInDeclaration(state: State): readonly core.$ZodType[] {
  const forgotten = [...state.reportedInDeclaration.keys()];
  state.reportedInDeclaration.clear();
  return forgotten;
}

/** Whether the tree holds a refusal of a cycle no id names, told once for each tree. */
function holdsUnnamedCycle(state: State, tree: FailureTree): boolean {
  const known = state.unnamedCycleIn.get(tree);
  if (known !== undefined) {
    return known;
  }
  const holds = tree.some((part) =>
    isFailureTree(part) ? holdsUnnamedCycle(state, part) : isUnnamedCycle(part),
  );
  state.unnamedCycleIn.set(tree, holds);
  return holds;
}
