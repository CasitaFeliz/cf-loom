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
  readonly holdsUnnamedCycleByTree: Map<FailureTree, boolean>;
};

/** The failures of one walk, which tells a failure that holds a cycle no id names once, when it is reported. */
export function startReported(): Reported {
  const state: State = {
    reportedBySchema: new Map(),
    reportedInDeclaration: new Map(),
    holdsUnnamedCycleByTree: new Map(),
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
 * each declaration walks afresh. A schema is in one of them only: one without an id is reported only
 * for its cycle no id names, always into the declaration map, and one with an id once, when its
 * def fails, answering from memory until the declaration map is cleared before any re-walk.
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
  const known = state.holdsUnnamedCycleByTree;
  const answered = known.get(tree);
  if (answered !== undefined) {
    return answered;
  }
  const open: OpenTree[] = [{ tree, next: 0 }];
  for (let reading = open.at(-1); reading !== undefined; reading = open.at(-1)) {
    const part = reading.tree[reading.next++];
    if (part === undefined) {
      known.set(reading.tree, false);
      open.pop();
      continue;
    }
    const holds = isFailureTree(part) ? known.get(part) : isUnnamedCycle(part);
    if (holds === true) {
      for (const holder of open) {
        known.set(holder.tree, true);
      }
      return true;
    }
    if (holds === undefined && isFailureTree(part)) {
      open.push({ tree: part, next: 0 });
    }
  }
  return false;
}

/** A failure tree being read, and the index of its next part. */
type OpenTree = { readonly tree: FailureTree; next: number };
