import { type Dirent, existsSync, globSync, readdirSync, readFileSync } from 'node:fs';
import { join, posix, relative, resolve, sep } from 'node:path';
import { type Entries, entriesOf } from './package-entries.ts';

/** A rule of [Package layout](../ARCHITECTURE.md#package-layout) that a path breaks. */
export type LayoutRule =
  | 'not-an-entry'
  | 'grab-bag'
  | 'nested-module'
  | 'past-the-index'
  | 'not-only-re-exports'
  | 'export-all'
  | 'missing-entry'
  | 'wildcard-export';

/** A path of a package, relative to the package's directory, and the layout rule it breaks. */
export type LayoutViolation = { readonly path: string; readonly rule: LayoutRule };

const grabBagNames = new Set(['utils', 'common', 'shared', 'helpers']);
const comment = /\/\*[\s\S]*?\*\/|\/\/[^\n]*/g;
const importSpecifier = /\b(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g;
const namedReExport = /^export\s+(?:type\s+)?\{[^}]*\}\s*from\s*['"][^'"]+['"]$/;
const emptyExport = /^export\s*\{\s*\}$/;
const exportAll = /^export\s+(?:type\s+)?\*/;
const moduleIndex = /^index\.(?:ts|js)$/;
const root = join(import.meta.dirname, '..');

/**
 * Every way the package in `packageDir` breaks the layout its `src/` must follow, sorted by path.
 * A folder with no `package.json` is no package and one with no `src/` has nothing to lay out.
 */
export function layoutViolations(packageDir: string): LayoutViolation[] {
  const manifestPath = join(packageDir, 'package.json');
  if (!(existsSync(manifestPath) && existsSync(join(packageDir, 'src')))) {
    return [];
  }
  const packageEntries = entriesOf(JSON.parse(readFileSync(manifestPath, 'utf8')));
  if (packageEntries.kind === 'wildcard') {
    return [{ path: 'package.json', rule: 'wildcard-export' }];
  }
  const { entries } = packageEntries;
  const violations = [
    ...folderViolations(packageDir, entries),
    ...importViolations(packageDir, entries),
    ...entryViolations(packageDir, entries),
  ];
  return violations.sort((left, right) => left.path.localeCompare(right.path));
}

function posixPathOf(packageDir: string, path: string): string {
  return relative(packageDir, path).split(sep).join('/');
}

/** What sits in `src/` and in each of its folders: entries, their tests and modules one level deep. */
function folderViolations(packageDir: string, entries: Entries): LayoutViolation[] {
  const violations: LayoutViolation[] = [];
  const dirents = readdirSync(join(packageDir, 'src'), { withFileTypes: true, recursive: true });
  for (const dirent of dirents) {
    const path = posixPathOf(packageDir, join(dirent.parentPath, dirent.name));
    const rule = folderRuleBroken(path, dirent, entries);
    if (rule !== undefined) {
      violations.push({ path, rule });
    }
  }
  return violations;
}

function folderRuleBroken(path: string, dirent: Dirent, entries: Entries): LayoutRule | undefined {
  const parent = posix.dirname(path);
  if (dirent.isDirectory()) {
    return directoryRuleBroken(path, parent, entries);
  }
  const isEntryOrTest = entries.files.has(path) || path.endsWith('.test.ts');
  return entries.folders.has(parent) && !isEntryOrTest ? 'not-an-entry' : undefined;
}

function directoryRuleBroken(
  path: string,
  parent: string,
  entries: Entries,
): LayoutRule | undefined {
  if (entries.folders.has(path)) {
    return undefined;
  }
  if (parent === 'src') {
    return grabBagNames.has(posix.basename(path)) ? 'grab-bag' : undefined;
  }
  if (entries.folders.has(parent)) {
    return 'not-an-entry';
  }
  return posix.dirname(parent) === 'src' ? 'nested-module' : undefined;
}

/**
 * The code of a source without its comments. Strings are not read, so a `//` or `/*` inside a
 * string literal is taken for a comment: a known gap, harmless in the import and export lines read.
 */
function codeOf(source: string): string {
  return source.replace(comment, '');
}

/** Each file whose imports reach into another module past its `index.ts`. */
function importViolations(packageDir: string, entries: Entries): LayoutViolation[] {
  const violations: LayoutViolation[] = [];
  const sources = globSync('src/**/*.ts', { cwd: packageDir });
  for (const path of sources.map((source) => source.split(sep).join('/'))) {
    const code = codeOf(readFileSync(join(packageDir, path), 'utf8'));
    const specifiers = [...code.matchAll(importSpecifier)].map((match) => match[1] ?? '');
    const imported = specifiers.filter((specifier) => specifier.startsWith('.'));
    const targets = imported.map((specifier) =>
      posixPathOf(packageDir, resolve(packageDir, posix.dirname(path), specifier)),
    );
    if (targets.some((target) => isPastTheIndex(path, target, entries))) {
      violations.push({ path, rule: 'past-the-index' });
    }
  }
  return violations;
}

function isPastTheIndex(importer: string, target: string, entries: Entries): boolean {
  const [folder, name, ...rest] = target.split('/');
  const targetModule = `${folder}/${name}`;
  if (folder !== 'src' || rest.length === 0 || entries.folders.has(targetModule)) {
    return false;
  }
  const importerModule = importer.split('/').slice(0, 2).join('/');
  return importerModule !== targetModule && !(rest.length === 1 && moduleIndex.test(rest[0] ?? ''));
}

/** Each entry with no source, and each entry other than a `bin` holding more than named re-exports. */
function entryViolations(packageDir: string, entries: Entries): LayoutViolation[] {
  const violations: LayoutViolation[] = [];
  for (const path of entries.files) {
    const rule = entryRuleBroken(packageDir, path, entries);
    if (rule !== undefined) {
      violations.push({ path, rule });
    }
  }
  return violations;
}

function entryRuleBroken(
  packageDir: string,
  path: string,
  entries: Entries,
): LayoutRule | undefined {
  if (!existsSync(join(packageDir, path))) {
    return 'missing-entry';
  }
  if (entries.bins.has(path)) {
    return undefined;
  }
  const code = codeOf(readFileSync(join(packageDir, path), 'utf8'));
  const statements = code
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean);
  if (statements.some((statement) => exportAll.test(statement))) {
    return 'export-all';
  }
  return statements.every(isReExport) ? undefined : 'not-only-re-exports';
}

function isReExport(statement: string): boolean {
  return namedReExport.test(statement) || emptyExport.test(statement);
}

function messageOf(rule: LayoutRule): string {
  switch (rule) {
    case 'not-an-entry':
      return 'only entries and their tests sit in src/ and an entry folder; move it into a module.';
    case 'grab-bag':
      return 'a module is named for its one responsibility, never utils, common, shared or helpers.';
    case 'nested-module':
      return 'modules are one level deep; split it into sibling modules.';
    case 'past-the-index':
      return "imports another module's file; a module is imported only through its index.ts.";
    case 'not-only-re-exports':
      return 'an entry file holds named re-exports only, `export { … } from`.';
    case 'export-all':
      return "an entry re-exports by name, `export { … } from`; Biome's noReExportAll refuses `export *`.";
    case 'missing-entry':
      return 'an entry that `exports` or `bin` points at has no source file.';
    case 'wildcard-export':
      return 'a wildcard subpath makes every file an entry; export each entry by name.';
  }
}

/** The package directories named on the command line, or every package under `packages/`. */
function checkPackages(packageDirs: readonly string[]): void {
  for (const packageDir of packageDirs) {
    for (const violation of layoutViolations(packageDir)) {
      const path = posixPathOf(process.cwd(), join(packageDir, violation.path));
      console.error(`${path} layout: ${messageOf(violation.rule)}`);
      process.exitCode = 1;
    }
  }
}

if (import.meta.main) {
  const named = process.argv.slice(2);
  checkPackages(
    named.length > 0 ? named : globSync('packages/*/', { cwd: root }).map((dir) => join(root, dir)),
  );
}
