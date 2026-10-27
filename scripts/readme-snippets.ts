import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, posix } from 'node:path';

/** A README: the path reports name it by, and its text. */
export type Readme = { readonly path: string; readonly markdown: string };

/**
 * What no README block shows of the Service the READMEs describe, by path: the files of the
 * Service, and under the name of a package (`@org/contract-payments-service`) the package's entry.
 */
export type Scope = Readonly<Record<string, string>>;

type Snippet = {
  readonly readme: string;
  readonly line: number;
  readonly path: string;
  readonly source: string;
};

type Provider = { readonly package: string } | { readonly file: string };

const root = join(import.meta.dirname, '..');
/** The example Service whose installed packages every snippet resolves its imports from. */
const installedIn = join(root, 'examples', 'billing-service');
const packagesAt = 'scope-packages';
const pathComment = /^\/\/\s+((?:[\w.-]+\/)+[\w.-]+\.ts)\b/;
const declaredName =
  /^export\s+(?:declare\s+)?(?:default\s+)?(?:async\s+)?(?:const|let|function|class|type|interface)\s+(\w+)/gm;
const exportList = /^export\s+(?:type\s+)?\{([^}]*)\}/gm;
const missingName =
  /^(.+?)\(\d+,\d+\): error TS(?:2304|2552|2503|18004): (?:Cannot find (?:name|namespace)|No value exists in scope for the shorthand property) '(\w+)'/;
const diagnostic = /^(.+?)\((\d+),\d+\): (error TS\d+: .*)$/;

/**
 * Why the TypeScript blocks of the READMEs do not compile, as `README:line: error TS…`, empty when
 * they do. A block leaves out the imports of zod, `@cf-loom/contract` and the names another block
 * or the scope declares; the check adds them, then type-checks each block as the file its path
 * comment names.
 */
export function snippetProblems(readmes: readonly Readme[], scope: Scope): string[] {
  const snippets = readmes.flatMap(snippetsOf);
  const files = filesOf(snippets, scope);
  const directory = mkdtempSync(join(tmpdir(), 'readme-snippets-'));
  try {
    symlinkSync(join(installedIn, 'node_modules'), join(directory, 'node_modules'));
    writeProject(directory, files, scope);
    const missing = missingNamesOf(compile(directory));
    writeProject(directory, withImports(files, missing, providersOf(files)), scope);
    return problemsOf(compile(directory), snippets);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function snippetsOf(readme: Readme): Snippet[] {
  const snippets: Snippet[] = [];
  const lines = readme.markdown.split('\n');
  for (let at = 0; at < lines.length; at++) {
    if (lines[at] !== '```ts') {
      continue;
    }
    const end = lines.indexOf('```', at + 1);
    const source = lines.slice(at + 1, end).join('\n');
    snippets.push({
      readme: readme.path,
      line: at + 2,
      path: pathOf(source, readme.path, at),
      source,
    });
    at = end;
  }
  return snippets;
}

/** The path a block's first line names, or one beside the other blocks of its README. */
function pathOf(source: string, readme: string, fenceAt: number): string {
  const named = pathComment.exec(source)?.[1];
  const slug = readme.replaceAll(/\W+/g, '-');
  return named ?? `snippets/${slug}-${fenceAt + 2}.ts`;
}

/** Every file of the project by path: the scope, and each block, a repeated path told apart. */
function filesOf(snippets: readonly Snippet[], scope: Scope): Map<string, string> {
  const files = new Map<string, string>(Object.entries(scope).map(inProject));
  for (const snippet of snippets) {
    const taken = files.has(snippet.path);
    const path = taken ? snippet.path.replace(/\.ts$/, `.${snippet.line}.ts`) : snippet.path;
    files.set(path, `${snippet.source}\nexport {};\n`);
  }
  return files;
}

/** A scope entry as a file of the project: a package's entry sits under `scope-packages/`. */
function inProject([path, source]: readonly [string, string]): [string, string] {
  return [path.startsWith('@') ? `${packagesAt}/${path}.ts` : path, source];
}

/** The package or the file that declares each name a block may leave out, the first one winning. */
function providersOf(files: ReadonlyMap<string, string>): Map<string, Provider> {
  const providers = new Map<string, Provider>([['z', { package: 'zod' }]]);
  for (const name of contractNames()) {
    providers.set(name, { package: '@cf-loom/contract' });
  }
  for (const [path, source] of files) {
    for (const match of source.matchAll(declaredName)) {
      const name = match[1] ?? '';
      providers.set(name, providers.get(name) ?? { file: path });
    }
  }
  return providers;
}

/** The names `@cf-loom/contract` exports, types included, as its declarations list them. */
function contractNames(): string[] {
  const declarations = join(installedIn, 'node_modules/@cf-loom/contract/dist/index.d.ts');
  const source = readFileSync(declarations, 'utf8');
  const listed = [...source.matchAll(exportList)].flatMap((match) =>
    (match[1] ?? '').split(',').map((entry) => entry.trim().split(/\s+/).at(-1) ?? ''),
  );
  return listed.filter((name) => /^\w+$/.test(name));
}

function writeProject(directory: string, files: ReadonlyMap<string, string>, scope: Scope): void {
  const manifest = { type: 'module' };
  writeFileSync(join(directory, 'package.json'), JSON.stringify(manifest));
  writeFileSync(join(directory, 'tsconfig.json'), JSON.stringify(tsconfigOf(scope)));
  for (const [path, source] of files) {
    mkdirSync(dirname(join(directory, path)), { recursive: true });
    writeFileSync(join(directory, path), source);
  }
}

/** The compiler options the root README recommends, with the scope's packages found where they sit. */
function tsconfigOf(scope: Scope) {
  const paths = Object.fromEntries(
    Object.keys(scope)
      .filter((path) => path.startsWith('@'))
      .map((name) => [name, [`./${packagesAt}/${name}.ts`]]),
  );
  return {
    compilerOptions: {
      allowImportingTsExtensions: true,
      erasableSyntaxOnly: true,
      lib: ['ES2024'],
      module: 'nodenext',
      noEmit: true,
      paths,
      skipLibCheck: true,
      strict: true,
      target: 'ES2024',
      types: ['node'],
    },
    include: ['**/*.ts'],
  };
}

/** The output of `tsc` over the project, one diagnostic per line. */
function compile(directory: string): string[] {
  const tsc = join(root, 'node_modules', 'typescript', 'bin', 'tsc');
  const ran = spawnSync(process.execPath, [tsc, '-p', '.', '--pretty', 'false'], {
    cwd: directory,
    encoding: 'utf8',
  });
  if (ran.error) {
    throw ran.error;
  }
  const output = ran.stdout.split('\n').filter((line) => line !== '');
  if (ran.status !== 0 && output.length === 0) {
    throw new Error(`tsc ended with status ${ran.status}: ${ran.stderr}`);
  }
  return output;
}

function missingNamesOf(output: readonly string[]): Map<string, Set<string>> {
  const missing = new Map<string, Set<string>>();
  for (const line of output) {
    const [, path, name] = missingName.exec(line) ?? [];
    if (path !== undefined && name !== undefined) {
      missing.set(path, (missing.get(path) ?? new Set()).add(name));
    }
  }
  return missing;
}

/** The files, each with the imports of the names it leaves out that something provides. */
function withImports(
  files: ReadonlyMap<string, string>,
  missing: ReadonlyMap<string, ReadonlySet<string>>,
  providers: ReadonlyMap<string, Provider>,
): Map<string, string> {
  const completed = new Map(files);
  for (const [path, names] of missing) {
    const lines = [...names].flatMap((name) => importOf(path, name, providers));
    completed.set(path, `${completed.get(path) ?? ''}${lines.join('\n')}\n`);
  }
  return completed;
}

function importOf(path: string, name: string, providers: ReadonlyMap<string, Provider>): string[] {
  const provider = providers.get(name);
  if (provider === undefined || ('file' in provider && provider.file === path)) {
    return [];
  }
  const specifier = 'package' in provider ? provider.package : relativeTo(path, provider.file);
  return [`import { ${name} } from '${specifier}';`];
}

function relativeTo(from: string, file: string): string {
  const relative = posix.relative(posix.dirname(from), file);
  return relative.startsWith('.') ? relative : `./${relative}`;
}

function problemsOf(output: readonly string[], snippets: readonly Snippet[]): string[] {
  const problems: string[] = [];
  for (const line of output) {
    const [, path, row, message] = diagnostic.exec(line) ?? [];
    if (path === undefined || row === undefined || message === undefined) {
      continue;
    }
    problems.push(`${locationOf(path, Number(row), snippets)}: ${message}`);
  }
  return problems;
}

/** The README line a diagnostic in a block's file is, or the file and line of one in the scope. */
function locationOf(path: string, row: number, snippets: readonly Snippet[]): string {
  const snippet = snippets.find((one) => path === one.path || path.endsWith(`.${one.line}.ts`));
  return snippet === undefined ? `${path}:${row}` : `${snippet.readme}:${snippet.line + row - 1}`;
}
