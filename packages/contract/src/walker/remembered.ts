import type * as core from 'zod/v4/core';
import type { NotAllowed } from './nodes.ts';
import { isUnnamedCycle, isWrittenTooDeep } from './not-allowed.ts';
import type { Entered } from './recursion-state.ts';
import { type FailureTree, isFailureTree, type Walked } from './walked.ts';

/**
 * The schemas a walk answers from memory, each kept with its group and its verdict on a cycle for
 * the whole walk and its answer for as long as that is kept, and whether a failure holds a schema
 * refused for its depth.
 */
export type Remembered = {
  readonly remember: (entered: Entered, answer: Walked) => void;
  /** The schema as the walk last remembered it, its answer gone once forgotten. */
  readonly enteredOf: (schema: core.$ZodType) => Entered | undefined;
  /** Forgets the answers each declaration walks afresh, and returns their schemas. */
  readonly forgetInDeclaration: () => readonly core.$ZodType[];
  /** Whether a failure holds a schema refused for its depth, so its walk did not see all it reaches. */
  readonly holdsWrittenTooDeep: (tree: FailureTree) => boolean;
};

type State = {
  readonly enteredBySchema: Map<core.$ZodType, Entered>;
  readonly keptInDeclaration: Set<Entered>;
  readonly holdsUnnamedCycle: (tree: FailureTree) => boolean;
};

/**
 * The schemas one walk remembers, which tells once for each failure tree whether it holds a cycle
 * no id names, and whether it holds a schema refused for its depth.
 */
export function startRemembered(): Remembered {
  const state: State = {
    enteredBySchema: new Map(),
    keptInDeclaration: new Set(),
    holdsUnnamedCycle: holdingReaderOf(isUnnamedCycle),
  };
  return {
    remember: (entered, answer) => remember(state, entered, answer),
    enteredOf: (schema) => state.enteredBySchema.get(schema),
    forgetInDeclaration: () => forgetInDeclaration(state),
    holdsWrittenTooDeep: holdingReaderOf(isWrittenTooDeep),
  };
}

/**
 * An answer is kept for the walk, or for the declaration when it is a failure that holds a cycle
 * no id names, which each declaration walks afresh.
 */
function remember(state: State, entered: Entered, answer: Walked): void {
  entered.answer = answer;
  state.enteredBySchema.set(entered.schema, entered);
  const isKeptInDeclaration = answer.kind === 'not-allowed' && state.holdsUnnamedCycle(answer.tree);
  if (isKeptInDeclaration) {
    state.keptInDeclaration.add(entered);
  } else {
    state.keptInDeclaration.delete(entered);
  }
}

/** The record stays, so a schema walked afresh keeps the verdict its first walk gave it. */
function forgetInDeclaration(state: State): readonly core.$ZodType[] {
  const forgotten = [...state.keptInDeclaration];
  state.keptInDeclaration.clear();
  for (const entered of forgotten) {
    entered.answer = undefined;
  }
  return forgotten.map((entered) => entered.schema);
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
