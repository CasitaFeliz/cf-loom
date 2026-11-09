import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { API, type Program } from 'typescript/unstable/sync';
import { hangTimeout } from './hang-timeout.ts';
import type { Project } from './readme-project.ts';

/** One diagnostic of `tsc`: the file and row it names, when it names one, with its code and message. */
export type Diagnostic = {
  readonly path: string | undefined;
  readonly row: number;
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
const located = /^(.+?)\((\d+),\d+\): error TS(\d+): (.*)$/;
const unlocated = /^error TS(\d+): (.*)$/;
const notFound = new Set([2304, 2552, 18004, 2503, 2662, 2663]);
const identifier = /^[A-Za-z_$][\w$]*/;

/** What `tsc -p .` printed over the project in `directory`, run with `extraArgs` besides. */
export function compile(directory: string, extraArgs: readonly string[] = []): Compiled {
  const args = [tsc, '-p', '.', '--pretty', 'false', ...extraArgs];
  const ran = spawnSync(process.execPath, args, {
    cwd: directory,
    encoding: 'utf8',
    timeout: hangTimeout,
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
 * The names `tsc` cannot find in each file of the project written to `directory`: each is the
 * identifier the source holds where `tsc` reports it, never a word of its message. They are read
 * per file from the TypeScript API, which reports a file's semantic diagnostics whatever another
 * file holds; the CLI reports none once one file has a syntax error.
 */
export function freeNamesOf(directory: string, project: Project): Map<string, Set<string>> {
  const api = new API({});
  try {
    const config = join(directory, 'tsconfig.json');
    const program = api.updateSnapshot({ openProjects: [config] }).getProject(config)?.program;
    if (program === undefined) {
      throw new Error(`${config} is not a TypeScript project`);
    }
    const freeNamesByPath = new Map<string, Set<string>>();
    for (const [path, { source }] of project) {
      const names = path.endsWith('.ts')
        ? namesNotFound(program, join(directory, path), source)
        : [];
      if (names.length > 0) {
        freeNamesByPath.set(path, new Set(names));
      }
    }
    return freeNamesByPath;
  } finally {
    api.close();
  }
}

function namesNotFound(program: Program, file: string, source: string): string[] {
  const names: string[] = [];
  for (const { code, pos } of program.getSemanticDiagnostics(file)) {
    const name = notFound.has(code) ? identifier.exec(source.slice(pos))?.[0] : undefined;
    if (name !== undefined) {
      names.push(name);
    }
  }
  return names;
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
  const [, path, row, code, message] = located.exec(line) ?? [];
  if (path !== undefined) {
    return { path, row: Number(row), code: Number(code), message: message ?? '' };
  }
  const [, bareCode, bareMessage] = unlocated.exec(line) ?? [];
  if (bareCode === undefined) {
    return undefined;
  }
  return { path: undefined, row: 0, code: Number(bareCode), message: bareMessage ?? '' };
}
