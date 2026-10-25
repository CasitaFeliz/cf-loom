import { failureLineOf } from '@cf-loom/contract/internal';
import {
  type BuiltProject,
  type Committed,
  committedLineEndingsOf,
  type ProjectFailure,
  snapshotFile,
} from '../project/index.ts';

/**
 * The exit statuses of the CLI's README: done, the check failed, a Breaking Change Approval is
 * needed, a tooling error.
 */
export type ExitStatus = 0 | 1 | 2 | 3;

/** What a command ends with: its exit status and the lines it prints on each stream. */
export type Exit = {
  readonly status: ExitStatus;
  readonly stdout: readonly string[];
  readonly stderr: readonly string[];
};

/** A command that ended before it did its work, with the exit it ends with. */
export type Stopped = { readonly kind: 'stopped'; readonly exit: Exit };

/** A command that did what was asked, with the lines that say what it did. */
export function done(lines: readonly string[]): Exit {
  return { status: 0, stdout: lines, stderr: [] };
}

/** A command whose check failed: a Change refused, a broken rule, or a generated file that differs. */
export function checkFailed(lines: readonly string[]): Exit {
  return { status: 1, stdout: [], stderr: lines };
}

/** A command that could not run: the configuration, a file it loads, or how it was called. */
export function toolingError(message: string): Exit {
  return { status: 3, stdout: [], stderr: [message] };
}

/** A project that could not be built, as the command ends: its rules broken, or a tooling error. */
export function failureExitOf(failure: ProjectFailure): Exit {
  switch (failure.kind) {
    case 'invalid':
      return checkFailed(failure.failures.map(failureLineOf));
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

/**
 * The stop of a command that works from the committed Snapshot when it is no JSON, or is not
 * what `generate` would write, so the command acts on the file that was reviewed.
 */
export function committedStopOf(built: BuiltProject): Exit | undefined {
  const noJson = noJsonExitOf(built.committed);
  if (noJson !== undefined) {
    return noJson;
  }
  switch (committedLineEndingsOf(built)) {
    case 'same':
      return undefined;
    case 'crlf':
      return checkFailed([crlfLineOf(snapshotFile)]);
    case 'different':
      return checkFailed([`${snapshotFile} is missing or out of date: run cf-loom generate`]);
  }
}

/** The line for a generated file that differs from what `generate` writes only by CRLF line endings, which Git adds on a checkout. */
export function crlfLineOf(path: string): string {
  return `${path} has CRLF line endings: set eol=lf in .gitattributes`;
}
