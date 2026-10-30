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
import { dirname, isAbsolute, join, posix, relative, sep } from 'node:path';
import { blocksOf, type Readme } from './readme-blocks.ts';
import { cfLoomProblemsOf, runCfLoom } from './readme-cf-loom.ts';
import { type Compiled, compile, describe, freeNamesOf } from './readme-compile.ts';
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
const typeCheckSkipped =
  'tsc: not run: cf-loom stopped a Service, so the files it writes are missing';

/** The place a report names for the file `path` of the Service, at `row`. */
type Locate = (path: string, row: number) => string;

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
    const locate = locatorOf(project, '');
    return [...problems, ...problemsOf(compile(directory), locate)];
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

/**
 * Writes the Service the READMEs describe to `directory`: the blocks of the READMEs of
 * `repository`, completed, and the files of `scripts/readme-service/`, which no block shows, then
 * what `cf-loom generate` and `cf-loom package` write for each Service the scope gives a
 * package.json, so it needs the CLI built; what stops a Service is kept for
 * `readmeServiceProblems`. It replaces what the directory held.
 */
export function writeReadmeService(directory: string, repository: string = root): void {
  const { project } = projectOfReadmes(readmesOf(repository), scopeOf(repository));
  rmSync(directory, { recursive: true, force: true });
  writeProject(directory, project, repository);
  runCfLoom(directory, [...project.keys()]);
}

/**
 * What stopped cf-loom in the Services of the Service written to `directory`, each at its README
 * line, else why it does not compile, as `snippetProblems` reports it: `tsc` checks the blocks
 * against the files cf-loom writes, so it does not run while a Service is stopped. It compiles
 * `directory` where it is and never writes to it.
 */
export function readmeServiceProblems(directory: string, repository: string = root): string[] {
  if (!existsSync(join(directory, 'tsconfig.json'))) {
    throw new Error(
      `The README Service is not written out: ${directory} is written when Vitest starts a project that vitest.config.ts gives it to`,
    );
  }
  const { problems, project } = projectOfReadmes(readmesOf(repository), scopeOf(repository));
  const locate = locatorOf(project, writtenAtOf(directory, repository));
  const refused = refusalsAt(directory, locate);
  if (refused.length > 0) {
    return [...problems, ...refused, typeCheckSkipped];
  }
  return [...problems, ...problemsOf(compile(directory), locate)];
}

/** What stopped cf-loom in the Services of the Service written to `directory`, each at its README line. */
export function readmeServiceRefusals(directory: string, repository: string = root): string[] {
  const { project } = projectOfReadmes(readmesOf(repository), scopeOf(repository));
  return refusalsAt(directory, locatorOf(project, writtenAtOf(directory, repository)));
}

function refusalsAt(directory: string, locate: Locate): string[] {
  return cfLoomProblemsOf(directory).map(({ path, row, message }) =>
    path === undefined ? message : `${locate(path, row)}: ${message}`,
  );
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
 * Writes the project twice: with no import added, to learn from TypeScript the names each file
 * leaves out, then with an import for each such name a provider has.
 */
function writeProject(directory: string, project: Project, repository: string): void {
  const providers = providersOf(project, contractNames(repository));
  mkdirSync(directory, { recursive: true });
  linkDependencies(directory, repository);
  writeFileSync(join(directory, 'package.json'), JSON.stringify({ type: 'module' }));
  writeFileSync(join(directory, 'tsconfig.json'), JSON.stringify(tsconfig));
  writeFiles(directory, project, () => new Map());
  const freeNamesByPath = freeNamesOf(directory, project);
  writeFiles(directory, project, (path) =>
    importsOf(path, freeNamesByPath.get(path) ?? new Set(), providers),
  );
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

function problemsOf(compiled: Compiled, locate: Locate): string[] {
  const problems = compiled.diagnostics.map((diagnostic) => {
    const { path, row } = diagnostic;
    return path === undefined
      ? `tsc: ${describe(diagnostic)}`
      : `${locate(path, row)}: ${describe(diagnostic)}`;
  });
  if (compiled.failed && problems.length === 0) {
    throw new Error(`tsc failed with no diagnostic: ${compiled.output}`);
  }
  return problems;
}

/**
 * Names a file of the Service by the README line it is, for a block, or by its file and line: in
 * the scope for a file of the scope, else in the written-out Service, as `writtenAt` says where
 * that is, for one cf-loom wrote.
 */
function locatorOf(project: Project, writtenAt: string): Locate {
  return (path, row) => {
    const file = project.get(path);
    if (file === undefined) {
      return `${posix.join(writtenAt, path)}:${row}`;
    }
    const { block } = file;
    return block === undefined
      ? `${scopeAt}/${path}:${row}`
      : `${block.readme}:${block.line + row - 1}`;
  };
}

/** Where `directory` is in `repository`, or nothing when it is not inside it. */
function writtenAtOf(directory: string, repository: string): string {
  const at = relative(repository, directory);
  return at.startsWith('..') || isAbsolute(at) ? '' : at.split(sep).join('/');
}
