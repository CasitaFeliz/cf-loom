import type * as core from 'zod/v4/core';
import type { NotAllowed } from './nodes.ts';
import { isUnnamedCycle, isWrittenTooDeep } from './not-allowed.ts';
import { type Failed, type FailureTree, isFailureTree } from './walked.ts';

/** The failing schemas a walk answers from memory, and for how long each is kept. */
export type Reported = {
  readonly report: (schema: core.$ZodType, failure: Failed) => void;
  readonly failureOf: (schema: core.$ZodType) => Failed | undefined;
  /** Forgets the failures each declaration walks afresh, and returns their schemas. */
  readonly forgetInDeclaration: () => readonly core.$ZodType[];
  /** Whether a failure holds a schema refused for its depth, so its walk did not see all it reaches. */
  readonly holdsWrittenTooDeep: (tree: FailureTree) => boolean;
};

type State = {
  readonly reportedBySchema: Map<core.$ZodType, Failed>;
  readonly reportedInDeclaration: Map<core.$ZodType, Failed>;
  readonly holdsUnnamedCycle: (tree: FailureTree) => boolean;
};

/**
 * The failures of one walk, which tells once for each failure tree whether it holds a cycle no id
 * names, and whether it holds a schema refused for its depth.
 */
export function startReported(): Reported {
  const state: State = {
    reportedBySchema: new Map(),
    reportedInDeclaration: new Map(),
    holdsUnnamedCycle: holdingReaderOf(isUnnamedCycle),
  };
  return {
    report: (schema, failure) => report(state, schema, failure),
    failureOf: (schema) =>
      state.reportedBySchema.get(schema) ?? state.reportedInDeclaration.get(schema),
    forgetInDeclaration: () => forgetInDeclaration(state),
    holdsWrittenTooDeep: holdingReaderOf(isWrittenTooDeep),
  };
}

/**
 * A failure is kept for the walk, or for the declaration when it holds a cycle no id names, which
 * each declaration walks afresh. A schema is in one of them only: one without an id is reported only
 * for its cycle no id names, always into the declaration map, and one with an id once, when its
 * def fails, answering from memory until the declaration map is cleared before any re-walk.
 */
function report(state: State, schema: core.$ZodType, failure: Failed): void {
  const kept = state.holdsUnnamedCycle(failure.tree)
    ? state.reportedInDeclaration
    : state.reportedBySchema;
  kept.set(schema, failure);
}

function forgetInDeclaration(state: State): readonly core.$ZodType[] {
  const forgotten = [...state.reportedInDeclaration.keys()];
  state.reportedInDeclaration.clear();
  return forgotten;
}

/**
 * Whether a failure tree holds a refusal `isHeld` picks, read with an explicit stack and told once
 * for each tree, since a failing def's tree is shared by every failure that holds it.
 */
function holdingReaderOf(isHeld: (refusal: NotAllowed) => boolean): (tree: FailureTree) => boolean {
  const known = new Map<FailureTree, boolean>();
  return (tree) => holds(tree, isHeld, known);
}

function holds(
  tree: FailureTree,
  isHeld: (refusal: NotAllowed) => boolean,
  known: Map<FailureTree, boolean>,
): boolean {
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
    const isFound = isFailureTree(part) ? known.get(part) : isHeld(part);
    if (isFound === true) {
      for (const holder of open) {
        known.set(holder.tree, true);
      }
      return true;
    }
    if (isFound === undefined && isFailureTree(part)) {
      open.push({ tree: part, next: 0 });
    }
  }
  return false;
}

/** A failure tree being read, and the index of its next part. */
type OpenTree = { readonly tree: FailureTree; next: number };
