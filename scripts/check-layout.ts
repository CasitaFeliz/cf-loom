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
  | 'missing-entry'
  | 'wildcard-export';

/** A path of a package, relative to the package's directory, and the layout rule it breaks. */
export type LayoutViolation = { readonly path: string; readonly rule: LayoutRule };

const grabBagNames = new Set(['utils', 'common', 'shared', 'helpers']);
const stringOrComment = /('(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*")|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g;
const importSpecifier = /\b(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g;
const namedReExport = /^export\s+(?:type\s+)?\{[^}]*\}\s*from\s*['"][^'"]+['"]$/;
const emptyExport = /^export\s*\{\s*\}$/;
const root = join(import.meta.dirname, '..');

/**
 * Every way the package in `packageDir` breaks the layout its `src/` must follow, sorted by path.
 * A folder with no `package.json` is no package, and is skipped.
 */
export function layoutViolations(packageDir: string): LayoutViolation[] {
  const manifestPath = join(packageDir, 'package.json');
  if (!existsSync(manifestPath)) {
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
  const srcDir = join(packageDir, 'src');
  const dirents = existsSync(srcDir)
    ? readdirSync(srcDir, { withFileTypes: true, recursive: true })
    : [];
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
 * The code of a source without its comments. Quoted strings are kept whole, so a `//` or `/*` in
 * one is no comment; a template literal is not read, a known gap no import or export line meets.
 */
function codeOf(source: string): string {
  return source.replace(stringOrComment, (_, quoted: string | undefined) => quoted ?? '');
}

/** Each file whose imports reach into another module past its `index.ts`. */
function importViolations(packageDir: string, entries: Entries): LayoutViolation[] {
  const violations: LayoutViolation[] = [];
  const sources = globSync('src/**/*.ts', { cwd: packageDir });
  for (const path of sources.map((source) => posixPathOf(packageDir, join(packageDir, source)))) {
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
  return importerModule !== targetModule && rest.join('/') !== 'index.ts';
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
    case 'missing-entry':
      return 'an entry that `exports` or `bin` points at has no source file.';
    case 'wildcard-export':
      return 'a wildcard subpath makes every file an entry; export each entry by name.';
  }
}

/** Every package under `packages/`, in order, each checked against the layout. */
function checkPackages(): void {
  const packageDirs = globSync('packages/*/', { cwd: root }).sort();
  for (const packageDir of packageDirs) {
    for (const violation of layoutViolations(join(root, packageDir))) {
      const path = posixPathOf(process.cwd(), join(root, packageDir, violation.path));
      console.error(`${path} layout: ${messageOf(violation.rule)}`);
      process.exitCode = 1;
    }
  }
}

if (import.meta.main) {
  checkPackages();
}
