import { type Dirent, globSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, posix, relative, resolve, sep } from 'node:path';

/** A rule of the package layout (ARCHITECTURE.md, Package layout) that a path breaks. */
export type LayoutRule =
  | 'not-an-entry'
  | 'grab-bag'
  | 'nested-module'
  | 'past-the-index'
  | 'not-only-re-exports';

/** A path of a package, relative to the package's directory, and the layout rule it breaks. */
export type LayoutViolation = { readonly path: string; readonly kind: LayoutRule };

type Entries = {
  readonly files: ReadonlySet<string>;
  readonly bins: ReadonlySet<string>;
  readonly folders: ReadonlySet<string>;
};

const grabBagNames = new Set(['utils', 'common', 'shared', 'helpers']);
const importSpecifier = /(?:\bfrom|^\s*import)\s*['"]([^'"]+)['"]/gm;
const reExport = /^export\s+(?:type\s+)?\{[^}]*\}(?:\s+from\s+['"][^'"]+['"])?$/;
const root = join(import.meta.dirname, '..');

/** Every way the package in `packageDir` breaks the layout its `src/` must follow. */
export function layoutViolations(packageDir: string): LayoutViolation[] {
  const srcDir = join(packageDir, 'src');
  const entries = entriesOf(JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')));
  const violations = [
    ...folderViolations(srcDir, entries),
    ...importViolations(srcDir, entries),
    ...entryViolations(srcDir, entries),
  ];
  return violations.map((violation) => ({ ...violation, path: `src/${violation.path}` }));
}

/** The files a package's `exports` and `bin` point at, read as their sources under `src/`. */
function entriesOf(manifest: { exports?: unknown; bin?: unknown }): Entries {
  const exported = targetsOf(manifest.exports).map(sourceOf);
  const bins = targetsOf(manifest.bin).map(sourceOf);
  const files = new Set([...exported, ...bins]);
  const folders = new Set([...files].map((file) => posix.dirname(file)));
  return { files, bins: new Set(bins), folders };
}

function targetsOf(field: unknown): string[] {
  if (typeof field === 'string') {
    return [field];
  }
  if (typeof field !== 'object' || field === null) {
    return [];
  }
  return Object.values(field).flatMap(targetsOf);
}

function sourceOf(target: string): string {
  return target.replace(/^\.\/dist\//, '').replace(/(?:\.d\.ts|\.js)$/, '.ts');
}

/** What sits in `src/` and in each of its folders: entries, their tests and modules one level deep. */
function folderViolations(srcDir: string, entries: Entries): LayoutViolation[] {
  const violations: LayoutViolation[] = [];
  for (const dirent of readdirSync(srcDir, { withFileTypes: true, recursive: true })) {
    const path = posix.join(relative(srcDir, dirent.parentPath).split(sep).join('/'), dirent.name);
    const kind = folderRuleBroken(path, dirent, entries);
    if (kind !== undefined) {
      violations.push({ path, kind });
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
  if (parent === '.') {
    return grabBagNames.has(path) ? 'grab-bag' : undefined;
  }
  if (entries.folders.has(parent)) {
    return 'not-an-entry';
  }
  return parent.includes('/') ? undefined : 'nested-module';
}

/** Each import that reaches into another module past its `index.ts`. */
function importViolations(srcDir: string, entries: Entries): LayoutViolation[] {
  const violations: LayoutViolation[] = [];
  for (const path of globSync('**/*.ts', { cwd: srcDir })) {
    const source = readFileSync(join(srcDir, path), 'utf8');
    const specifiers = [...source.matchAll(importSpecifier)].map((match) => match[1] ?? '');
    const imported = specifiers.filter((specifier) => specifier.startsWith('.'));
    const targets = imported.map((specifier) =>
      relative(srcDir, resolve(srcDir, dirname(path), specifier)),
    );
    if (targets.some((target) => isPastTheIndex(path, target, entries))) {
      violations.push({ path: path.split(sep).join('/'), kind: 'past-the-index' });
    }
  }
  return violations;
}

function isPastTheIndex(importer: string, target: string, entries: Entries): boolean {
  const [module, ...rest] = target.split(sep);
  if (module === undefined || rest.length === 0 || module === '..' || entries.folders.has(module)) {
    return false;
  }
  const importerModule = importer.split(sep)[0];
  return importerModule !== module && rest.join('/') !== 'index.ts';
}

/** Entry files other than a `bin` hold re-exports only, so an entry cannot grow logic. */
function entryViolations(srcDir: string, entries: Entries): LayoutViolation[] {
  const violations: LayoutViolation[] = [];
  for (const path of entries.files) {
    if (!(entries.bins.has(path) || isOnlyReExports(readFileSync(join(srcDir, path), 'utf8')))) {
      violations.push({ path, kind: 'not-only-re-exports' });
    }
  }
  return violations;
}

function isOnlyReExports(source: string): boolean {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const statements = code.split(';').map((statement) => statement.trim());
  return statements.every((statement) => statement === '' || reExport.test(statement));
}

function messageOf(kind: LayoutRule): string {
  switch (kind) {
    case 'not-an-entry':
      return 'only entries and their tests sit in src/ and an entry folder; move it into a module.';
    case 'grab-bag':
      return 'a module is named for its one responsibility, never utils, common, shared or helpers.';
    case 'nested-module':
      return 'modules are one level deep; split it into sibling modules.';
    case 'past-the-index':
      return "imports another module's file; a module is imported only through its index.ts.";
    case 'not-only-re-exports':
      return 'an entry file holds re-exports only.';
  }
}

/** Every package under `packages/`, each checked against the layout. */
function checkPackages(): void {
  for (const packageDir of globSync('packages/*/', { cwd: root })) {
    for (const violation of layoutViolations(join(root, packageDir))) {
      const path = relative(process.cwd(), join(root, packageDir, violation.path));
      console.error(`${path} layout: ${messageOf(violation.kind)}`);
      process.exitCode = 1;
    }
  }
}

if (import.meta.main) {
  checkPackages();
}
