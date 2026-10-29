import { posix } from 'node:path';
import type { Block } from './readme-blocks.ts';
import { declaredNames, exportedNames, mentionedNames, ownNames } from './readme-names.ts';

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

/** Where the scope's packages sit in the project, found by the compiler options and the aliases. */
export const packagesAt = 'scope-packages';

/**
 * The project the blocks and the scope make. Of several files that name one path the scope's, then
 * the last block's, is that file: it extends the ones before it, which are written under other names.
 */
export function projectOf(blocks: readonly Block[], scope: Scope): Map<string, ProjectFile> {
  const project = new Map<string, ProjectFile>();
  for (const [path, source] of Object.entries(scope)) {
    project.set(path, { source });
  }
  const last = new Map(blocks.map((block) => [block.path, block]));
  for (const block of blocks) {
    const taken = project.has(block.path) || last.get(block.path) !== block;
    const slug = block.readme.replaceAll(/\W+/g, '-');
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
export function declaredTwice(project: Project): string[] {
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

/** Who provides the names a block leaves out: the contract's exports and each package's own files. */
export function providersOf(project: Project, contract: readonly string[]): Providers {
  const siblings = new Map<string, Map<string, string>>();
  for (const [path, file] of project) {
    const own = siblings.get(packageOf(path)) ?? new Map<string, string>();
    for (const name of path.endsWith('.ts') && isImportable(path, file)
      ? exportedNames(file.source)
      : []) {
      own.set(name, own.get(name) ?? path);
    }
    siblings.set(packageOf(path), own);
  }
  return { contract: new Set(contract), siblings };
}

/** Whether other files may import from the file: one a block names or the scope holds, not a snippet. */
function isImportable(path: string, file: ProjectFile): boolean {
  return file.block === undefined || (file.block.named && file.block.path === path);
}

/**
 * The file with an import of each name it mentions and does not declare, after its code so lines
 * stay. A snippet no path names also exports what it declares, for the tests that run it.
 */
export function completed(path: string, file: ProjectFile, providers: Providers): string {
  if (!path.endsWith('.ts')) {
    return file.source;
  }
  const own = declaredNames(file.source);
  const lines: string[] = [];
  for (const name of mentionedNames(file.source)) {
    const specifier = own.has(name) ? undefined : specifierOf(name, path, providers);
    if (specifier !== undefined) {
      lines.push(`import { ${name} } from '${specifier}';`);
    }
  }
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
