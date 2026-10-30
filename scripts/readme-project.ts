import { posix } from 'node:path';
import { type Block, serviceOf } from './readme-blocks.ts';
import { exportedNames, ownNames } from './readme-names.ts';

/** The files of the Service the READMEs describe that no README block shows, by path. */
export type Scope = Readonly<Record<string, string>>;

/** A file of the project the blocks are checked in: a block, or a file of the scope. */
export type ProjectFile = { readonly source: string; readonly block?: Block };

/** The files of the Service the READMEs describe, by path: the blocks and the scope. */
export type Project = ReadonlyMap<string, ProjectFile>;

/** What a block may leave out: zod's `z`, the exports of `@cf-loom/contract` and its package's files. */
export type Providers = {
  readonly contract: ReadonlySet<string>;
  readonly siblings: ReadonlyMap<string, ReadonlyMap<string, string>>;
};

/**
 * The project the blocks and the scope make: each block is the file its path names. A path names
 * one file once, so a block whose path an earlier block or the scope already names is left out
 * and reported, as `README:line: …`, with what its author does about it.
 */
export function projectOf(
  blocks: readonly Block[],
  scope: Scope,
): { project: Map<string, ProjectFile>; problems: string[] } {
  const project = new Map<string, ProjectFile>();
  const problems: string[] = [];
  for (const [path, source] of Object.entries(scope)) {
    project.set(path, { source });
  }
  for (const block of blocks) {
    const claimed = project.get(block.path);
    if (claimed === undefined) {
      project.set(block.path, { source: block.source, block });
    } else {
      problems.push(
        `${block.readme}:${block.line}: ${block.path} is also ${claimOf(claimed.block)}`,
      );
    }
  }
  return { project, problems };
}

/** Who holds a path already, and how the author names the later block otherwise. */
function claimOf(holder: Block | undefined): string {
  if (holder === undefined) {
    return 'a file of the scope: the scope holds only what no block shows, so its file goes or the block names another path';
  }
  const at = `${holder.readme}:${holder.line}`;
  return holder.named
    ? `named at ${at}: a path names a whole file of a Service once, so a block that shows another Service names its folder, and one that shows part of a file names no path`
    : `the snippet at ${at}: snippets are named by their heading, so one of the headings changes`;
}

/** The package a file belongs to: a Service's file that Service's, else the Service. */
function packageOf(path: string): string {
  return serviceOf(path) ?? '';
}

/** A name a block and a scope file of one package both export: the scope holds what no block shows. */
export function declaredTwice(project: Project): string[] {
  const exporters = new Map<string, { name: string; blocks: Block[]; scoped: string[] }>();
  for (const [path, file] of project) {
    for (const name of path.endsWith('.ts') ? exportedNames(file.source) : []) {
      const key = `${packageOf(path)} ${name}`;
      const exporter = exporters.get(key) ?? { name, blocks: [], scoped: [] };
      if (file.block === undefined) {
        exporter.scoped.push(path);
      } else {
        exporter.blocks.push(file.block);
      }
      exporters.set(key, exporter);
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

/** Who provides the names a block leaves out: the contract's exports and each package's own files. */
export function providersOf(project: Project, contract: readonly string[]): Providers {
  const siblings = new Map<string, Map<string, string>>();
  for (const [path, file] of project) {
    const own = siblings.get(packageOf(path)) ?? new Map<string, string>();
    for (const name of path.endsWith('.ts') && isImportable(file)
      ? exportedNames(file.source)
      : []) {
      own.set(name, own.get(name) ?? path);
    }
    siblings.set(packageOf(path), own);
  }
  return { contract: new Set(contract), siblings };
}

/** Whether other files may import from the file: any but a snippet. */
function isImportable(file: ProjectFile): boolean {
  return file.block?.named !== false;
}

/** Whether the check completes the file with imports: a `.ts` file that is no test, which is written in full. */
export function isCompleted(path: string): boolean {
  return path.endsWith('.ts') && !path.startsWith('test/');
}

/**
 * The module each of the names TypeScript cannot find in a file is imported from, for those a
 * provider has: a sibling file of its package, `zod` or `@cf-loom/contract`.
 */
export function importsOf(
  path: string,
  free: ReadonlySet<string>,
  providers: Providers,
): Map<string, string> {
  const imports = new Map<string, string>();
  for (const name of free) {
    const specifier = specifierOf(name, path, providers);
    if (specifier !== undefined) {
      imports.set(name, specifier);
    }
  }
  return imports;
}

/**
 * The file with the imports, after its code so lines stay. A snippet no path names also exports
 * what it declares, for the tests that run it; a test is written in full and left as it is.
 */
export function completed(
  path: string,
  file: ProjectFile,
  imports: ReadonlyMap<string, string>,
): string {
  if (!isCompleted(path)) {
    return file.source;
  }
  const lines = [...imports].map(([name, specifier]) => `import { ${name} } from '${specifier}';`);
  const exports = file.block?.named === false ? ownNames(file.source) : [];
  return `${file.source}\n${lines.join('\n')}\nexport { ${exports.join(', ')} };\n`;
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
