import type { Document, ExitStatus } from './exit.ts';

/** How a finding ends a command: the exit status it asks for, with what it says on stderr; 0 for lines that carry no status. */
export type Ending = {
  readonly status: Exclude<ExitStatus, 3>;
  readonly stderr: readonly string[];
};

/** What one step of a command established: the lines that say it on stdout, the fields of the `--json` document that hold it, and how it ends the command. */
export type Finding = {
  readonly lines?: readonly string[];
  readonly fields?: Document;
  readonly ending?: Ending;
};

/** Where and when a command runs, and the environment npm runs with, passed in so a run depends on nothing else. */
export type Run = {
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Reports what a step found, so it is printed, and kept in the document, however the command ends. */
  readonly report: (finding: Finding) => void;
};
