import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, posix } from 'node:path';
import { type Block, blocksOf, type Readme } from './readme-blocks.ts';
import { declaredNames, exportedNames, mentionedNames } from './readme-names.ts';

/**
 * What no README block shows of the Service the READMEs describe, by path: the files of the
 * Service, and under the name of a package (`@org/contract-payments-service`) the package's entry.
 */
export type Scope = Readonly<Record<string, string>>;

/** A file of the project the blocks are checked in: a block, or a file of the scope. */
type ProjectFile = { readonly source: string; readonly block?: Block };
type Project = ReadonlyMap<string, ProjectFile>;

/** What a block may leave out: zod's `z`, the exports of `@cf-loom/contract` and its package's files. */
type Providers = {
  readonly contract: ReadonlySet<string>;
  readonly siblings: ReadonlyMap<string, ReadonlyMap<string, string>>;
};

type Compiled = { readonly failed: boolean; readonly lines: string[] };

const root = join(import.meta.dirname, '..');
/** The example Service whose installed packages every block resolves its imports from. */
const installedIn = join(root, 'examples', 'billing-service');
const packagesAt = 'scope-packages';
const diagnostic = /^(.+?)\((\d+),\d+\): (error TS\d+: .*)$/;

/**
 * Why the TypeScript blocks of the READMEs do not compile, as `README:line: error TS…`, empty when
 * they do. A block leaves out the imports of zod, `@cf-loom/contract` and the files of its own
 * package; the check adds them, then type-checks each block as the file its path comment names.
 */
export function snippetProblems(readmes: readonly Readme[], scope: Scope): string[] {
  const parsed = readmes.map(blocksOf);
  const blocks = parsed.flatMap((one) => one.blocks);
  const project = projectOf(blocks, scope);
  const unreadable = parsed.flatMap((one) => one.problems);
  return [...unreadable, ...declaredTwice(project), ...checked(project)];
}

function projectOf(blocks: readonly Block[], scope: Scope): Map<string, ProjectFile> {
  const project = new Map<string, ProjectFile>();
  for (const [path, source] of Object.entries(scope)) {
    project.set(path.startsWith('@') ? `${packagesAt}/${path}.ts` : path, { source });
  }
  for (const block of blocks) {
    const slug = block.readme.replaceAll(/\W+/g, '-');
    const taken = project.has(block.path);
    const file = taken ? block.path.replace(/\.ts$/, `.${slug}-${block.line}.ts`) : block.path;
    project.set(file, { source: block.source, block });
  }
  return project;
}

/** The package a file belongs to: `<folder>/src/…` is that folder's, a scope package its own, else the Service. */
function packageOf(path: string): string {
  const [folder = '', second] = path.split('/');
  if (folder === packagesAt) {
    return path;
  }
  return second === 'src' ? folder : '';
}

/** A name a block and a scope file of one package both export: the scope holds what no block shows. */
function declaredTwice(project: Project): string[] {
  const exporters = new Map<string, { name: string; blocks: Block[]; scoped: string[] }>();
  for (const [path, file] of project) {
    for (const name of path.endsWith('.ts') ? exportedNames(file.source) : []) {
      const key = `${packageOf(path)} ${name}`;
      const entry = exporters.get(key) ?? { name, blocks: [], scoped: [] };
      if (file.block === undefined) {
        entry.scoped.push(path);
      } else {
        entry.blocks.push(file.block);
      }
      exporters.set(key, entry);
    }
  }
  const problems: string[] = [];
  for (const { name, blocks, scoped } of exporters.values()) {
    const [block] = blocks;
    const [file] = scoped;
    if (block !== undefined && file !== undefined) {
      const declared = `${name} is declared by the block and by the scope file ${file}`;
      problems.push(`${block.readme}:${block.line}: ${declared}`);
    }
  }
  return problems;
}

function providersOf(project: Project): Providers {
  const siblings = new Map<string, Map<string, string>>();
  for (const [path, file] of project) {
    const own = siblings.get(packageOf(path)) ?? new Map<string, string>();
    for (const name of path.endsWith('.ts') ? exportedNames(file.source) : []) {
      own.set(name, own.get(name) ?? path);
    }
    siblings.set(packageOf(path), own);
  }
  return { contract: new Set(contractNames()), siblings };
}

/** The names `@cf-loom/contract` exports, types included, as its declarations list them. */
function contractNames(): string[] {
  const declarations = join(installedIn, 'node_modules/@cf-loom/contract/dist/index.d.ts');
  const source = readFileSync(declarations, 'utf8');
  const lists = [...source.matchAll(/^export\s+(?:type\s+)?\{([^}]*)\}/gm)];
  const entries = lists.flatMap((list) => (list[1] ?? '').split(','));
  const names = entries.map((entry) => entry.trim().split(/\s+/).at(-1) ?? '');
  return names.filter((name) => /^\w+$/.test(name));
}

/** The file with an import of each name it mentions and does not declare, after its code so lines stay. */
function completed(path: string, source: string, providers: Providers): string {
  if (!path.endsWith('.ts')) {
    return source;
  }
  const own = declaredNames(source);
  const lines: string[] = [];
  for (const name of mentionedNames(source)) {
    const specifier = own.has(name) ? undefined : specifierOf(name, path, providers);
    if (specifier !== undefined) {
      lines.push(`import { ${name} } from '${specifier}';`);
    }
  }
  return `${source}\n${lines.join('\n')}\nexport {};\n`;
}

function specifierOf(name: string, from: string, providers: Providers): string | undefined {
  const file = providers.siblings.get(packageOf(from))?.get(name);
  if (file !== undefined && file !== from) {
    const relative = posix.relative(posix.dirname(from), file);
    return relative.startsWith('.') ? relative : `./${relative}`;
  }
  if (name === 'z') {
    return 'zod';
  }
  return providers.contract.has(name) ? '@cf-loom/contract' : undefined;
}

function checked(project: Project): string[] {
  if (![...project.keys()].some((path) => path.endsWith('.ts'))) {
    return [];
  }
  const providers = providersOf(project);
  const directory = mkdtempSync(join(tmpdir(), 'readme-snippets-'));
  try {
    symlinkSync(join(installedIn, 'node_modules'), join(directory, 'node_modules'));
    writeFileSync(join(directory, 'package.json'), JSON.stringify({ type: 'module' }));
    writeFileSync(join(directory, 'tsconfig.json'), JSON.stringify(tsconfigOf(project)));
    for (const [path, file] of project) {
      mkdirSync(dirname(join(directory, path)), { recursive: true });
      writeFileSync(join(directory, path), completed(path, file.source, providers));
    }
    return problemsOf(compile(directory), project);
  } finally {
    rmSync(directory, { recursive: true, force: true });
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
  return block === undefined ? `${path}:${row}` : `${block.readme}:${block.line + row - 1}`;
}
