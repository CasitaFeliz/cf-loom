import type { Exit } from './exit.ts';

/** How a command prints: its lines, or one JSON document on stdout. */
export type Output = 'lines' | 'json';

/** The format of every document `--json` prints. */
const documentFormat = 1;

/**
 * An Exit as the CLI prints it: its lines, or on stdout the one document `{ format, status, ... }`
 * that the Exit holds, with the lines of its stderr as `errors` when its status is not 0; stderr
 * keeps its lines either way.
 */
export function printedExitOf(exit: Exit, output: Output): Exit {
  switch (output) {
    case 'lines':
      return exit;
    case 'json':
      return { ...exit, stdout: [JSON.stringify(documentOf(exit))] };
  }
}

function documentOf({ status, stderr, document }: Exit): object {
  const errors = status === 0 ? {} : { errors: stderr };
  return { format: documentFormat, status, ...errors, ...document };
}
