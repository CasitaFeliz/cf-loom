import { readFileSync, realpathSync } from 'node:fs';
import { findPackageJSON } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { type Imported, importedModuleOf, oneLineOf } from './imported.ts';

/** A package as installed where the root imports it: its version and what its module exports. */
export type InstalledPackage =
  | { readonly kind: 'installed'; readonly version: string; readonly exports: readonly unknown[] }
  | { readonly kind: 'failed'; readonly message: string };

/** Where a package is looked up: from the root file, as the root imports it, in its project. */
export type LookedUp = { readonly rootPath: string; readonly directory: string };

/** The conditions Node imports a package's entry under, in the order a package lists them. */
const conditions: readonly string[] = ['node', 'import', 'default'];

/**
 * Finds a package as the root file imports it and imports its module itself, the same instance
 * the root holds, so what it exports can be compared with what it lists.
 */
export async function installedPackageOf(
  packageName: string,
  { rootPath, directory }: LookedUp,
): Promise<InstalledPackage> {
  const manifestPath = manifestPathOf(packageName, rootPath);
  const manifest = manifestPath === undefined ? undefined : manifestIn(manifestPath);
  if (manifestPath === undefined || manifest === undefined) {
    return { kind: 'failed', message: `${packageName} is not installed: install it to list it` };
  }
  const version = manifest['version'];
  if (typeof version !== 'string') {
    return { kind: 'failed', message: `${packageName} has no version in its package.json` };
  }
  const imported = await entryModuleOf(join(dirname(manifestPath), entryOf(manifest)), directory);
  if (imported.kind === 'failed') {
    return { kind: 'failed', message: `${packageName} cannot be loaded: ${imported.message}` };
  }
  return { kind: 'installed', version, exports: Object.values(imported.exports) };
}

/** The package's entry as Node imports it, at its real path; an entry that is missing is a failure. */
async function entryModuleOf(entry: string, directory: string): Promise<Imported> {
  try {
    return await importedModuleOf(realpathSync(entry), directory);
  } catch (e) {
    return { kind: 'failed', message: oneLineOf(e, directory) };
  }
}

/** Where Node finds the package's package.json from the root file, as the root imports it. */
function manifestPathOf(packageName: string, rootPath: string): string | undefined {
  try {
    return findPackageJSON(packageName, pathToFileURL(rootPath));
  } catch {
    return undefined;
  }
}

function manifestIn(path: string): Readonly<Record<string, unknown>> | undefined {
  try {
    const manifest: unknown = JSON.parse(readFileSync(path, 'utf8'));
    return typeof manifest === 'object' && manifest !== null ? { ...manifest } : undefined;
  } catch {
    return undefined;
  }
}

/** The file a package's `.` entry names for an import under Node, else its `main`. */
function entryOf(manifest: Readonly<Record<string, unknown>>): string {
  const main = manifest['main'];
  return targetOf(manifest['exports']) ?? (typeof main === 'string' ? main : 'index.js');
}

function targetOf(exported: unknown): string | undefined {
  if (typeof exported === 'string') {
    return exported;
  }
  if (Array.isArray(exported)) {
    return exported.map(targetOf).find((target) => target !== undefined);
  }
  if (typeof exported !== 'object' || exported === null) {
    return undefined;
  }
  const entries = Object.entries(exported);
  if (entries.some(([key]) => key.startsWith('.'))) {
    return targetOf(Reflect.get(exported, '.'));
  }
  const matching = entries.filter(([condition]) => conditions.includes(condition));
  return matching.map(([, target]) => targetOf(target)).find((target) => target !== undefined);
}
