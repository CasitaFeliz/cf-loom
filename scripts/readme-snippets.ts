import { spawnSync } from 'node:child_process';
import {
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
import {
  completed,
  declaredTwice,
  type Project,
  packagesAt,
  projectOf,
  providersOf,
  type Scope,
} from './readme-project.ts';

type Compiled = { readonly failed: boolean; readonly lines: string[] };

const root = join(import.meta.dirname, '..');
const packagesWithReadmes = ['contract', 'handlers', 'messaging', 'server'];
const scopeAt = 'scripts/readme-service';
const diagnostic = /^(.+?)\((\d+),\d+\): (error TS\d+: .*)$/;

/**
 * Why the TypeScript blocks of the READMEs do not compile, as `README:line: error TS…`, empty when
 * they do. A block leaves out the imports of zod, `@cf-loom/contract` and the files of its own
 * package; the check adds them, then type-checks each block as the file its path comment names.
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
 * `repository`, completed, and the files of `scripts/readme-service/`, which no block shows. It
 * replaces what the directory held and reads no built package.
 */
export function writeReadmeService(directory: string, repository: string = root): void {
  const { project } = projectOfReadmes(readmesOf(repository), scopeOf(repository));
  rmSync(directory, { recursive: true, force: true });
  writeProject(directory, project, repository);
}

/**
 * Why the Service written to `directory` does not compile, as `snippetProblems` reports it. It
 * compiles `directory` where it is and never writes to it.
 */
export function readmeServiceProblems(directory: string, repository: string = root): string[] {
  const { problems, project } = projectOfReadmes(readmesOf(repository), scopeOf(repository));
  return [...problems, ...problemsOf(compile(directory), project)];
}

function projectOfReadmes(readmes: readonly Readme[], scope: Scope) {
  const parsed = readmes.map(blocksOf);
  const project = projectOf(
    parsed.flatMap((one) => one.blocks),
    scope,
  );
  const unreadable = parsed.flatMap((one) => one.problems);
  return { problems: [...unreadable, ...declaredTwice(project)], project };
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

/** The names `@cf-loom/contract` exports, types included, as its entry lists them. */
function contractNames(repository: string): string[] {
  const source = readFileSync(join(repository, 'packages/contract/src/index.ts'), 'utf8');
  const lists = [...source.matchAll(/^export\s+(?:type\s+)?\{([^}]*)\}/gm)];
  const entries = lists.flatMap((list) => (list[1] ?? '').split(','));
  const names = entries.map((entry) => entry.trim().split(/\s+/).at(-1) ?? '');
  return names.filter((name) => /^\w+$/.test(name));
}

function writeProject(directory: string, project: Project, repository: string): void {
  const providers = providersOf(project, contractNames(repository));
  mkdirSync(directory, { recursive: true });
  symlinkSync(
    join(repository, 'examples', 'billing-service', 'node_modules'),
    join(directory, 'node_modules'),
  );
  writeFileSync(join(directory, 'package.json'), JSON.stringify({ type: 'module' }));
  writeFileSync(join(directory, 'tsconfig.json'), JSON.stringify(tsconfigOf(project)));
  for (const [path, file] of project) {
    mkdirSync(dirname(join(directory, path)), { recursive: true });
    writeFileSync(join(directory, path), completed(path, file, providers));
  }
}

/** The compiler options the root README recommends, with the scope's packages found where they sit. */
function tsconfigOf(project: Project) {
  const entries = [...project.keys()]
    .filter((path) => path.startsWith(`${packagesAt}/`))
    .map((path) => [path.slice(packagesAt.length + 1).replace(/\.ts$/, ''), [`./${path}`]]);
  return {
    compilerOptions: {
      allowImportingTsExtensions: true,
      erasableSyntaxOnly: true,
      lib: ['ES2024'],
      module: 'nodenext',
      noEmit: true,
      paths: Object.fromEntries(entries),
      skipLibCheck: true,
      strict: true,
      target: 'ES2024',
      types: ['node'],
    },
    include: ['**/*.ts'],
  };
}

/** What `tsc` printed over the project, and whether it ended in failure. */
function compile(directory: string): Compiled {
  const tsc = join(root, 'node_modules', 'typescript', 'bin', 'tsc');
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
