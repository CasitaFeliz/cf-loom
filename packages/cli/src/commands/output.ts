import type { Exit, ExitStatus } from './exit.ts';
import type { Ending, Finding } from './run.ts';

/** How a command prints: its lines, or one JSON document on stdout. */
export type Output = 'lines' | 'json';

/** The format of every document `--json` prints. */
const documentFormat = 2;

/** The README's order of what a command finds: a tooling error, a failed check, a needed Approval, then lines that carry no status. */
const ranking = [3, 1, 2, 0] as const;

/** What ranks a command's exit: the status it asks for with the lines it says on stderr. */
type Ranked = Pick<Exit, 'status' | 'stderr'>;

/**
 * The exit the CLI prints once a command ended: the status that ranks first among the exit's and
 * the findings', stderr in that rank with ties in the order found and the exit's last, and every
 * field found merged in order under the exit's own document.
 */
export function reportedExitOf(findings: readonly Finding[], exit: Exit): Exit {
  const ranked = [...endingsOf(findings), exit];
  const document = fieldsOf(findings);
  Object.assign(document, exit.document);
  return { ...exit, status: statusOf(ranked), stderr: stderrOf(ranked), document };
}

function endingsOf(findings: readonly Finding[]): readonly Ending[] {
  const endings: Ending[] = [];
  for (const { ending } of findings) {
    if (ending !== undefined) {
      endings.push(ending);
    }
  }
  return endings;
}

function fieldsOf(findings: readonly Finding[]): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  for (const { fields } of findings) {
    Object.assign(merged, fields);
  }
  return merged;
}

function statusOf(ranked: readonly Ranked[]): ExitStatus {
  const statuses = ranked.map(({ status }) => status);
  return ranking.find((rank) => statuses.includes(rank)) ?? 0;
}

function stderrOf(ranked: readonly Ranked[]): readonly string[] {
  const lines: string[] = [];
  for (const rank of ranking) {
    const ofRank = ranked.filter(({ status }) => status === rank);
    for (const { stderr } of ofRank) {
      for (const line of stderr) {
        lines.push(line);
      }
    }
  }
  return lines;
}

/**
 * An Exit as the CLI prints it: its lines, or on stdout the one document `{ format, status, ... }`
 * that the Exit holds, with the lines of its stderr as `errors` when it has any; stderr keeps its
 * lines either way.
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
  const errors = stderr.length === 0 ? {} : { errors: stderr };
  return { format: documentFormat, status, ...errors, ...document };
}
