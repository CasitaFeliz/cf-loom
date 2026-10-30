import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import type { Project } from './readme-project.ts';

/** What `tsc` printed over a folder, and whether it ended in failure. */
export type Compiled = { readonly failed: boolean; readonly lines: string[] };

/** The `tsc` of the repository, which type-checks the README Service and builds its Contract Packages. */
export const tsc = join(import.meta.dirname, '..', 'node_modules', 'typescript', 'bin', 'tsc');
const notFound = /^(.+?)\((\d+),(\d+)\): error TS(?:2304|2552|18004|2503|2662|2663): /;
const identifier = /^[A-Za-z_$][\w$]*/;

/** What `tsc` printed over the project in `directory`. */
export function compile(directory: string): Compiled {
  const ran = spawnSync(process.execPath, [tsc, '-p', '.', '--pretty', 'false'], {
    cwd: directory,
    encoding: 'utf8',
  });
  if (ran.error) {
    throw ran.error;
  }
  const lines = ran.stdout.split('\n').filter((line) => line !== '');
  return { failed: ran.status !== 0, lines: lines.length > 0 ? lines : [ran.stderr] };
}

/**
 * The names `tsc` cannot find in each file of the project: each is the identifier the source holds
 * where `tsc` reports it, never a word of its message.
 */
export function freeNamesOf(compiled: Compiled, project: Project): Map<string, Set<string>> {
  const free = new Map<string, Set<string>>();
  const rowsOf = new Map<string, string[]>();
  for (const line of compiled.lines) {
    const [, path, row, column] = notFound.exec(line) ?? [];
    const source = project.get(path ?? '')?.source;
    if (path === undefined || source === undefined) {
      continue;
    }
    const rows = rowsOf.get(path) ?? source.split('\n');
    rowsOf.set(path, rows);
    const name = identifier.exec((rows[Number(row) - 1] ?? '').slice(Number(column) - 1))?.[0];
    if (name !== undefined) {
      free.set(path, (free.get(path) ?? new Set<string>()).add(name));
    }
  }
  return free;
}
