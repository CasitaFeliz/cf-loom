import { globSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { API, DiagnosticCategory, type Program, type Snapshot } from 'typescript/unstable/sync';

const directiveLine = /^[ \t]*\/\/\/?[ \t]*@ts-expect-error\b(?:[ \t]+(TS\d+)\b)?/;
const projectPatterns = [
  'packages/*/tsconfig.test.json',
  'examples/*/tsconfig.json',
  'tsconfig.tooling.json',
];
const root = join(import.meta.dirname, '..');

/** A `@ts-expect-error` whose line below does not fail with the code it names (C23). */
export type ExpectErrorProblem = {
  /** The absolute path of the file. */
  readonly path: string;
  /** The 1-based line of the directive. */
  readonly line: number;
  /** The code the directive names, such as `TS2345`, or `undefined` when it names none. */
  readonly named: string | undefined;
  /** The codes the line below fails with, ascending and without repeats; empty when it does not fail. */
  readonly produced: readonly string[];
};

type Source = {
  readonly path: string;
  readonly text: string;
  readonly lines: readonly string[];
  /** The 0-based lines that hold a directive, each with the code it names, if any. */
  readonly directives: ReadonlyMap<number, string | undefined>;
};

/**
 * `source` with each directive turned into a plain comment of the same length, so that the errors
 * it would suppress are reported, at the same places.
 */
function withoutDirectives(source: string): string {
  return source
    .split('\n')
    .map((line) =>
      directiveLine.test(line) ? line.replace('@ts-expect-error', '#ts-expect-error') : line,
    )
    .join('\n');
}

function isOwnSource(path: string): boolean {
  return path.endsWith('.ts') && !path.endsWith('.d.ts') && !path.includes('/node_modules/');
}

/** What `tsc` is given to read in place of a source: `undefined` leaves the file to the disk. */
function neutralizedSource(path: string): string | undefined {
  return isOwnSource(path) ? withoutDirectives(readFileSync(path, 'utf8')) : undefined;
}

/** The file at `path` read for its directives, or `undefined` when it holds none. */
function sourceWithDirectives(path: string): Source | undefined {
  const text = readFileSync(path, 'utf8');
  const lines = text.split(/\r?\n/);
  const directives = new Map<number, string | undefined>();
  for (const [index, line] of lines.entries()) {
    const match = directiveLine.exec(line);
    if (match !== null) {
      directives.set(index, match[1]);
    }
  }
  return directives.size === 0 ? undefined : { path, text, lines, directives };
}

/** The directive that covers a 0-based line as `tsc` finds it: the first above it, over blank and comment lines only. */
function directiveAbove(source: Source, line: number): number | undefined {
  for (let above = line - 1; above >= 0; above -= 1) {
    if (source.directives.has(above)) {
      return above;
    }
    const text = (source.lines[above] ?? '').trim();
    if (text !== '' && !text.startsWith('//')) {
      return undefined;
    }
  }
  return undefined;
}

/** The codes of the errors each directive of the file covers, by the directive's 0-based line. */
function codesUnderDirectives(program: Program, source: Source): Map<number, Set<number>> {
  const codes = new Map<number, Set<number>>();
  for (const line of source.directives.keys()) {
    codes.set(line, new Set());
  }
  for (const { category, code, pos } of program.getSemanticDiagnostics(source.path)) {
    const line = source.text.slice(0, pos).split('\n').length - 1;
    const directive = directiveAbove(source, line);
    if (category === DiagnosticCategory.Error && directive !== undefined) {
      codes.get(directive)?.add(code);
    }
  }
  return codes;
}

function problemsInFile(program: Program, source: Source): ExpectErrorProblem[] {
  const codes = codesUnderDirectives(program, source);
  const problems: ExpectErrorProblem[] = [];
  for (const [line, named] of source.directives) {
    const failures = [...(codes.get(line) ?? [])].sort((left, right) => left - right);
    const produced = failures.map((code) => `TS${code}`);
    if (named === undefined || !produced.includes(named)) {
      problems.push({ path: source.path, line: line + 1, named, produced });
    }
  }
  return problems;
}

function problemsInProject(snapshot: Snapshot, configPath: string): ExpectErrorProblem[] {
  const project = snapshot.getProject(configPath);
  if (project === undefined) {
    throw new Error(`${configPath} is not a TypeScript project.`);
  }
  const problems: ExpectErrorProblem[] = [];
  for (const path of project.program.getSourceFileNames().filter(isOwnSource)) {
    const source = sourceWithDirectives(path);
    if (source === undefined) {
      continue;
    }
    for (const problem of problemsInFile(project.program, source)) {
      problems.push(problem);
    }
  }
  return problems;
}

/**
 * Each `@ts-expect-error` directive in the projects whose tsconfig files are `configPaths` that
 * names no error, or one the line below does not fail with, by path and line. A project that links
 * a package built by `pnpm build` is checked once it is built.
 *
 * A directive is a `//` comment on a line of its own; one inside a block comment or after code is
 * not read, and neither is one in a string that a test compiles when it runs.
 */
export function expectErrorProblems(configPaths: readonly string[]): ExpectErrorProblem[] {
  const api = new API({ fs: { readFile: neutralizedSource } });
  try {
    const snapshot = api.updateSnapshot({ openProjects: [...configPaths] });
    const problems = new Map<string, ExpectErrorProblem>();
    for (const configPath of configPaths) {
      for (const problem of problemsInProject(snapshot, configPath)) {
        problems.set(`${problem.path}:${problem.line}`, problem);
      }
    }
    return [...problems.values()].sort(
      (left, right) => left.path.localeCompare(right.path) || left.line - right.line,
    );
  } finally {
    api.close();
  }
}

function messageOf({ named, produced }: ExpectErrorProblem): string {
  const fails = produced.length === 0 ? 'does not fail' : `fails with ${produced.join(', ')}`;
  return named === undefined
    ? `C23: a @ts-expect-error names the error it expects, TS<code> before its reason; the line below ${fails}.`
    : `C23: the line below ${fails}, not ${named}.`;
}

/** The test projects of the packages and the examples, and the tooling, checked for directives that prove nothing. */
function checkProjects(): void {
  const configPaths = projectPatterns
    .flatMap((pattern) => globSync(pattern, { cwd: root }))
    .map((path) => join(root, path));
  for (const problem of expectErrorProblems(configPaths)) {
    const shown = relative(process.cwd(), problem.path);
    console.error(`${shown}:${problem.line} ${messageOf(problem)}`);
    process.exitCode = 1;
  }
}

if (import.meta.main) {
  checkProjects();
}
