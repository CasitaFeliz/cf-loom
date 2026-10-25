import { randomUUID } from 'node:crypto';
import { existsSync, linkSync, mkdirSync, renameSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { oneLineOf } from '../loading/index.ts';

/** A file to move, both paths relative to the project. */
export type FileMove = { readonly from: string; readonly to: string };

/** The files moved, or the move a failure stopped at, in one line, with every file back where it was. */
export type Moved =
  | { readonly kind: 'moved'; readonly moves: readonly FileMove[] }
  | { readonly kind: 'failed'; readonly message: string };

/** A file set aside beside the path it will take. */
type SetAside = FileMove & { readonly temporary: string };

/**
 * Moves each file to its new path, in two steps: every source is set aside beside its destination
 * before any lands, so a path one file leaves can be the path another takes, and none overwrites a
 * file. A failure puts every file back.
 */
export function moveFiles(directory: string, moves: readonly FileMove[]): Moved {
  const aside: SetAside[] = [];
  for (const move of moves) {
    const set = setAside(directory, move);
    if (set.kind === 'failed') {
      restore(directory, aside);
      return set;
    }
    aside.push(set.file);
  }
  for (const file of aside) {
    const placed = place(directory, file);
    if (placed.kind === 'failed') {
      restore(directory, aside);
      return placed;
    }
  }
  return { kind: 'moved', moves };
}

type StepFailed = { readonly kind: 'failed'; readonly message: string };

function setAside(
  directory: string,
  move: FileMove,
): { readonly kind: 'set'; readonly file: SetAside } | StepFailed {
  const temporary = `${move.to}.${randomUUID()}.tmp`;
  try {
    mkdirSync(dirname(join(directory, move.to)), { recursive: true });
    renameSync(join(directory, move.from), join(directory, temporary));
    return { kind: 'set', file: { ...move, temporary } };
  } catch (e) {
    return failureOf(directory, move, e);
  }
}

/** Puts a set-aside file at its path, linking it there so a file already there is never overwritten. */
function place(directory: string, file: SetAside): { readonly kind: 'placed' } | StepFailed {
  try {
    linkSync(join(directory, file.temporary), join(directory, file.to));
    unlinkSync(join(directory, file.temporary));
    return { kind: 'placed' };
  } catch (e) {
    return failureOf(directory, file, e);
  }
}

function failureOf(directory: string, move: FileMove, thrown: unknown): StepFailed {
  return {
    kind: 'failed',
    message: `${move.from} cannot be moved to ${move.to}: ${reasonOf(directory, thrown)}`,
  };
}

/** Why a step failed in one line, naming the paths of the move and never the name a file was set aside under. */
function reasonOf(directory: string, thrown: unknown): string {
  if (thrown instanceof Error && 'code' in thrown && thrown.code === 'EEXIST') {
    return 'a file is already there';
  }
  return oneLineOf(thrown, directory).replace(/\.[0-9a-f-]{36}\.tmp/g, '');
}

/**
 * Puts each file back where it came from, never over another: first every file that landed back
 * to the name it was set aside under, then each set-aside file to its source, so a path one file
 * left and another took is free again before its owner returns.
 */
function restore(directory: string, aside: readonly SetAside[]): void {
  for (const file of aside) {
    if (existsSync(join(directory, file.to)) && !existsSync(join(directory, file.temporary))) {
      relink(directory, file.to, file.temporary);
    }
  }
  for (const file of aside) {
    relink(directory, file.temporary, file.from);
  }
}

/** Gives a file another name without overwriting, a file already there being left as it is. */
function relink(directory: string, from: string, to: string): void {
  try {
    linkSync(join(directory, from), join(directory, to));
    unlinkSync(join(directory, from));
  } catch {
    return;
  }
}
