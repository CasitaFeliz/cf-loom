import type { Failure, Path } from '@casitafeliz/loom-contract/internal';
import { type Committed, type ProjectFailure, snapshotFile } from '../project/index.ts';

/** The exit statuses of the CLI's README: done, the check failed, a tooling error. */
export type ExitStatus = 0 | 1 | 3;

/** What a command ends with: its exit status and the lines it prints on each stream. */
export type Exit = {
  readonly status: ExitStatus;
  readonly stdout: readonly string[];
  readonly stderr: readonly string[];
};

/** A command that did what was asked, with the lines that say what it did. */
export function done(lines: readonly string[]): Exit {
  return { status: 0, stdout: lines, stderr: [] };
}

/** A command whose check failed: something not allowed, or a generated file that differs. */
export function checkFailed(lines: readonly string[]): Exit {
  return { status: 1, stdout: [], stderr: lines };
}

/** A command that could not run: the configuration, a file it loads, or how it was called. */
export function toolingError(message: string): Exit {
  return { status: 3, stdout: [], stderr: [message] };
}

/** One failure on one line, where it sits first, in the order the validation found them. */
export function failureLine(failure: Failure): string {
  const location = locationOf(failure.at);
  switch (failure.kind) {
    case 'declaration':
      return `${location} ${failure.rule}: ${failure.message}`;
    case 'not-allowed':
      return failure.instead === undefined
        ? `${location} not allowed: ${failure.construct}`
        : `${location} not allowed: ${failure.construct} (use ${failure.instead})`;
  }
}

function locationOf(at: Path): string {
  return at.length === 0 ? '(root)' : at.join('.');
}

/** A project that could not be built, as the command ends: its rules broken, or a tooling error. */
export function failureExitOf(failure: ProjectFailure): Exit {
  switch (failure.kind) {
    case 'invalid':
      return checkFailed(failure.failures.map(failureLine));
    case 'tooling':
      return toolingError(failure.message);
  }
}

/**
 * The stop of a command that writes from the Snapshot when the committed file is no JSON: its
 * author restores or deletes it, since its `deprecatedAt` stamps would be lost.
 */
export function noJsonExitOf(committed: Committed): Exit | undefined {
  if (committed.kind !== 'no-json') {
    return undefined;
  }
  const { reason } = committed;
  return toolingError(
    `${snapshotFile} is no JSON (${reason}): restore it or delete it, then run cf-loom generate`,
  );
}
