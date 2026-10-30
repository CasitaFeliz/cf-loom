import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import type { Project } from './readme-project.ts';

/** One diagnostic of `tsc`: the file, row and column it names, when it names one, with its code and message. */
export type Diagnostic = {
  readonly path: string | undefined;
  readonly row: number;
  readonly column: number;
  readonly code: number;
  readonly message: string;
};

/** What `tsc` printed over a folder: its diagnostics, whether it ended in failure, and its output as printed. */
export type Compiled = {
  readonly failed: boolean;
  readonly diagnostics: Diagnostic[];
  readonly output: string;
};

const tsc = join(import.meta.dirname, '..', 'node_modules', 'typescript', 'bin', 'tsc');
/** Long enough for a slow runner, short enough that a hung command fails the write-out. */
export const timeoutMs = 60_000;
const located = /^(.+?)\((\d+),(\d+)\): error TS(\d+): (.*)$/;
const unlocated = /^error TS(\d+): (.*)$/;
const notFound = new Set([2304, 2552, 18004, 2503, 2662, 2663]);
const identifier = /^[A-Za-z_$][\w$]*/;

/** What `tsc -p .` printed over the project in `directory`, run with `extraArgs` besides. */
export function compile(directory: string, extraArgs: readonly string[] = []): Compiled {
  const args = [tsc, '-p', '.', '--pretty', 'false', ...extraArgs];
  const ran = spawnSync(process.execPath, args, {
    cwd: directory,
    encoding: 'utf8',
    timeout: timeoutMs,
  });
  if (ran.error) {
    throw new Error(`tsc did not finish in ${directory}: ${ran.error.message}`);
  }
  const output = ran.stdout.trim() === '' ? ran.stderr : ran.stdout;
  return { failed: ran.status !== 0, diagnostics: diagnosticsIn(ran.stdout), output };
}

/** A diagnostic as `tsc` prints it, without its place: `error TS2322: Type …`. */
export function describe({ code, message }: Diagnostic): string {
  return `error TS${code}: ${message}`;
}

/**
 * Whether `tsc` found a syntax error (TS1xxx), after which it reports no other kind: a project
 * that has one is not completed, so what depends on its completion would be refused for it.
 */
export function hasSyntaxError({ diagnostics }: Compiled): boolean {
  return diagnostics.some(({ code }) => code >= 1000 && code < 2000);
}

/**
 * The names `tsc` cannot find in each file of the project: each is the identifier the source holds
 * where `tsc` reports it, never a word of its message.
 */
export function freeNamesOf({ diagnostics }: Compiled, project: Project): Map<string, Set<string>> {
  const freeNamesByPath = new Map<string, Set<string>>();
  const rowsByPath = new Map<string, string[]>();
  for (const { path, row, column, code } of diagnostics) {
    const source = project.get(path ?? '')?.source;
    if (path === undefined || source === undefined || !notFound.has(code)) {
      continue;
    }
    const rows = rowsByPath.get(path) ?? source.split('\n');
    rowsByPath.set(path, rows);
    const name = identifier.exec((rows[row - 1] ?? '').slice(column - 1))?.[0];
    if (name !== undefined) {
      freeNamesByPath.set(path, (freeNamesByPath.get(path) ?? new Set<string>()).add(name));
    }
  }
  return freeNamesByPath;
}

function diagnosticsIn(output: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const line of output.split('\n')) {
    const diagnostic = diagnosticOf(line);
    if (diagnostic !== undefined) {
      diagnostics.push(diagnostic);
    }
  }
  return diagnostics;
}

function diagnosticOf(line: string): Diagnostic | undefined {
  const [, path, row, column, code, message] = located.exec(line) ?? [];
  if (path !== undefined) {
    return {
      path,
      row: Number(row),
      column: Number(column),
      code: Number(code),
      message: message ?? '',
    };
  }
  const [, bareCode, bareMessage] = unlocated.exec(line) ?? [];
  if (bareCode === undefined) {
    return undefined;
  }
  return { path: undefined, row: 0, column: 0, code: Number(bareCode), message: bareMessage ?? '' };
}
