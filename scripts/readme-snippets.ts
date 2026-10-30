import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { blocksOf, type Readme } from './readme-blocks.ts';
import { cfLoomProblemsOf, runCfLoom } from './readme-cf-loom.ts';
import { type Compiled, compile, freeNamesOf } from './readme-compile.ts';
import {
  completed,
  declaredTwice,
  importsOf,
  type Project,
  projectOf,
  providersOf,
  type Scope,
} from './readme-project.ts';

const root = join(import.meta.dirname, '..');
const packagesWithReadmes = ['contract', 'handlers', 'messaging', 'server', 'client', 'testing'];
const scopeAt = 'scripts/readme-service';
const diagnostic = /^(.+?)\((\d+),\d+\): (error TS\d+: .*)$/;

/**
 * Why the TypeScript blocks of the READMEs do not compile, as `README:line: error TS…`, empty when
 * they do. A block leaves out the imports of zod, `@cf-loom/contract` and the files of its own
 * package; the check adds an import of each name `tsc` cannot find that one of them provides,
 * then type-checks each block as the file its path comment names.
 * The project is written to a temporary folder, so the READMEs are the caller's own.
 */
export function snippetProblems(readmes: readonly Readme[], scope: Scope): string[] {
  const directory = mkdtempSync(join(tmpdir(), 'readme-snippets-'));
  try {
    const { problems, project } = projectOfReadmes(readmes, scope);
    if (![...project.keys()].some((path) => path.endsWith('.ts'))) {
      return problems;
    }
    writeProject(directory, project, root);
    return [...problems, ...problemsOf(compile(directory), project)];
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

/**
 * Writes the Service the READMEs describe to `directory`: the blocks of the READMEs of
 * `repository`, completed, and the files of `scripts/readme-service/`, which no block shows, then
 * what `cf-loom generate` and `cf-loom package` write for each Service the scope gives a
 * package.json, so it needs the CLI built; what cf-loom refuses is kept for
 * `readmeServiceProblems`. It replaces what the directory held.
 */
export function writeReadmeService(directory: string, repository: string = root): void {
  const { project } = projectOfReadmes(readmesOf(repository), scopeOf(repository));
  rmSync(directory, { recursive: true, force: true });
  writeProject(directory, project, repository);
  runCfLoom(directory, [...project.keys()]);
}

/**
 * Why the Service written to `directory` does not compile, as `snippetProblems` reports it, and
 * what cf-loom refused in its Services, each at its README line. It compiles `directory`
 * where it is and never writes to it.
 */
export function readmeServiceProblems(directory: string, repository: string = root): string[] {
  if (!existsSync(join(directory, 'tsconfig.json'))) {
    throw new Error(
      `The README Service is not written out: ${directory} is written when Vitest loads vitest.config.ts`,
    );
  }
  const { problems, project } = projectOfReadmes(readmesOf(repository), scopeOf(repository));
  const refused = cfLoomProblemsOf(directory).map(({ path, row, message }) =>
    path === undefined ? `cf-loom: ${message}` : `${locationOf(path, row, project)}: ${message}`,
  );
  return [...problems, ...refused, ...problemsOf(compile(directory), project)];
}

function projectOfReadmes(readmes: readonly Readme[], scope: Scope) {
  const parsed = readmes.map(blocksOf);
  const blocks = parsed.flatMap((readmeBlocks) => readmeBlocks.blocks);
  const { project, problems: claimedTwice } = projectOf(blocks, scope);
  const unreadable = parsed.flatMap((readmeBlocks) => readmeBlocks.problems);
  const problems = [...unreadable, ...claimedTwice, ...declaredTwice(project)];
  return { problems, project };
}

function readmesOf(repository: string): Readme[] {
  return packagesWithReadmes.map((name) => {
    const path = `packages/${name}/README.md`;
    return { path, markdown: readFileSync(join(repository, path), 'utf8') };
  });
}

/** The files under `scripts/readme-service/`, by their path inside it. */
function scopeOf(repository: string): Scope {
  const folder = join(repository, scopeAt);
  const files = readdirSync(folder, { recursive: true, encoding: 'utf8' });
  const paths = files.filter((path) => statSync(join(folder, path)).isFile());
  return Object.fromEntries(paths.map((path) => [path, readFileSync(join(folder, path), 'utf8')]));
}

/** The names `@cf-loom/contract` exports, types included, as its `index.ts` lists them. */
function contractNames(repository: string): string[] {
  const source = readFileSync(join(repository, 'packages/contract/src/index.ts'), 'utf8');
  const lists = [...source.matchAll(/^export\s+(?:type\s+)?\{([^}]*)\}/gm)];
  const exported = lists.flatMap((list) => (list[1] ?? '').split(','));
  const names = exported.map((name) => name.trim().split(/\s+/).at(-1) ?? '');
  return names.filter((name) => /^\w+$/.test(name));
}

/**
 * Writes the project twice: with no import added, to learn from `tsc` the names each file leaves
 * out, then with an import for each such name a provider has.
 */
function writeProject(directory: string, project: Project, repository: string): void {
  const providers = providersOf(project, contractNames(repository));
  mkdirSync(directory, { recursive: true });
  linkDependencies(directory, repository);
  writeFileSync(join(directory, 'package.json'), JSON.stringify({ type: 'module' }));
  writeFileSync(join(directory, 'tsconfig.json'), JSON.stringify(tsconfig));
  writeFiles(directory, project, () => new Map());
  const free = freeNamesOf(compile(directory), project);
  writeFiles(directory, project, (path) => importsOf(path, free.get(path) ?? new Set(), providers));
}

function writeFiles(
  directory: string,
  project: Project,
  importsFor: (path: string) => ReadonlyMap<string, string>,
): void {
  for (const [path, file] of project) {
    mkdirSync(dirname(join(directory, path)), { recursive: true });
    writeFileSync(join(directory, path), completed(path, file, importsFor(path)));
  }
}

/** The compiler options the root README recommends. */
const tsconfig = {
  compilerOptions: {
    allowImportingTsExtensions: true,
    erasableSyntaxOnly: true,
    lib: ['ES2024'],
    module: 'nodenext',
    noEmit: true,
    skipLibCheck: true,
    strict: true,
    target: 'ES2024',
    types: ['node'],
  },
  include: ['**/*.ts'],
};

/** Installs what the Services depend on as billing-service has them, but the organization's own packages, which the scope installs. */
function linkDependencies(directory: string, repository: string): void {
  const installed = join(repository, 'examples', 'billing-service', 'node_modules');
  mkdirSync(join(directory, 'node_modules'));
  for (const name of readdirSync(installed)) {
    if (!name.startsWith('.') && name !== '@org') {
      symlinkSync(join(installed, name), join(directory, 'node_modules', name));
    }
  }
}

function problemsOf(compiled: Compiled, project: Project): string[] {
  const problems: string[] = [];
  for (const line of compiled.lines) {
    const [, path, row, message] = diagnostic.exec(line) ?? [];
    if (path !== undefined && row !== undefined && message !== undefined) {
      problems.push(`${locationOf(path, Number(row), project)}: ${message}`);
    } else if (/^error TS\d+:/.test(line)) {
      problems.push(`tsc: ${line}`);
    }
  }
  if (compiled.failed && problems.length === 0) {
    throw new Error(`tsc failed with no diagnostic: ${compiled.lines.join('\n')}`);
  }
  return problems;
}

/** The README line a diagnostic in a block's file is, or the file and line of one in the scope. */
function locationOf(path: string, row: number, project: Project): string {
  const block = project.get(path)?.block;
  return block === undefined
    ? `${scopeAt}/${path}:${row}`
    : `${block.readme}:${block.line + row - 1}`;
}
