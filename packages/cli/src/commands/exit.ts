import type { Failure, Path } from '@casitafeliz/loom-contract/internal';

/** The exit statuses of the CLI's README: done, the check failed, a tooling error. */
export type ExitStatus = 0 | 1 | 3;

/** What a command ends with: its exit status and the lines it prints on each stream. */
export type Exit = {
  readonly status: ExitStatus;
  readonly stdout: readonly string[];
  readonly stderr: readonly string[];
};

/** Where and when a command runs, passed in so a run depends on nothing else. */
export type Run = { readonly cwd: string; readonly now: number };

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
