import { readFileSync, realpathSync } from 'node:fs';
import { findPackageJSON, registerHooks } from 'node:module';
import { join } from 'node:path';
import { byCodePoint } from '@cf-loom/contract/internal';
import { type Imported, importedModuleOf } from './imported.ts';

/** A module of a package the root's import reached, as Node resolved it: the instance the root holds. */
export type ImportedPackage = {
  /** The file URL Node resolved it to; specifiers resolving to one URL are one module. */
  readonly url: string;
  /** The name in its package.json, or the package.json's path when it names none. */
  readonly packageName: string;
  /** Its package.json's path: two installed copies of one name are two packages. */
  readonly manifestPath: string;
  /** The version in its package.json, which a package used for development only may lack. */
  readonly version: string | undefined;
  /**
   * The first, in code point order, of the bare specifiers the project's own files import it by,
   * which a stub imports from; none when only other packages import it.
   */
  readonly specifier: string | undefined;
  /** The package.json paths of the packages whose files import it, `project` for the project's own. */
  readonly importedBy: readonly string[];
  readonly exports: Readonly<Record<string, unknown>>;
};

/** A root file as Node imported it, with every package its import reached, or why it could not be. */
export type ImportedRoot =
  | {
      readonly kind: 'imported';
      readonly exports: Readonly<Record<string, unknown>>;
      readonly imported: readonly ImportedPackage[];
    }
  | Extract<Imported, { readonly kind: 'failed' }>;

/** A bare specifier Node resolved: the file that imports it and the file it resolved to. */
type Resolution = {
  readonly specifier: string;
  readonly parentUrl: string | undefined;
  readonly url: string;
};

/** What `importedBy` names the project's own files as. */
const projectImporter = 'project';

/**
 * Imports the root file of the project in `directory` while a resolve hook records every bare
 * specifier Node resolves, whichever file imports it, so the packages are the ones Node chose.
 */
export async function importedRootOf(path: string, directory: string): Promise<ImportedRoot> {
  const resolutions: Resolution[] = [];
  const hooks = registerHooks({
    resolve: (specifier, context, nextResolve) => {
      const resolved = nextResolve(specifier, context);
      if (isBare(specifier) && resolved.url.startsWith('file:')) {
        resolutions.push({ specifier, parentUrl: context.parentURL, url: resolved.url });
      }
      return resolved;
    },
  });
  let root: Imported;
  try {
    root = await importedModuleOf(path, directory);
  } finally {
    hooks.deregister();
  }
  if (root.kind === 'failed') {
    return root;
  }
  const imported = await importedPackagesOf(resolutions, directory);
  return { kind: 'imported', exports: root.exports, imported };
}

/** Whether a specifier names a package, not a file, a URL or one of the package's own imports. */
function isBare(specifier: string): boolean {
  return !/^[./#]/.test(specifier) && !specifier.includes(':');
}

async function importedPackagesOf(
  resolutions: readonly Resolution[],
  directory: string,
): Promise<readonly ImportedPackage[]> {
  const projectManifest = realpathSync(join(directory, 'package.json'));
  const urls = [...new Set(resolutions.map(({ url }) => url))].sort(byCodePoint);
  const packages: ImportedPackage[] = [];
  for (const url of urls) {
    const manifest = manifestOf(url);
    if (manifest !== undefined) {
      const reaching = resolutions.filter((resolution) => resolution.url === url);
      const importers = reaching.map(({ parentUrl }) => importerOf(parentUrl, projectManifest));
      const fromProject = reaching.filter((_, index) => importers[index] === projectImporter);
      const [specifier] = fromProject.map((resolution) => resolution.specifier).sort(byCodePoint);
      const importedBy = [...new Set(importers.filter(isText))].sort(byCodePoint);
      const exports = await exportsOf(url);
      packages.push({ url, ...manifest, specifier, importedBy, exports });
    }
  }
  return packages;
}

/** The package.json a file sits under: its path, name and version. */
function manifestOf(
  url: string,
): Pick<ImportedPackage, 'packageName' | 'manifestPath' | 'version'> | undefined {
  const manifestPath = findPackageJSON(url);
  if (manifestPath === undefined) {
    return undefined;
  }
  const manifest = parsedOf(manifestPath);
  const name = manifest?.['name'];
  const version = manifest?.['version'];
  return {
    packageName: typeof name === 'string' ? name : manifestPath,
    manifestPath,
    version: typeof version === 'string' ? version : undefined,
  };
}

/** Who imports a module: the project's own files, or a package by its package.json's path. */
function importerOf(parentUrl: string | undefined, projectManifest: string): string | undefined {
  const path = parentUrl === undefined ? undefined : findPackageJSON(parentUrl);
  return path === projectManifest ? projectImporter : path;
}

/** What a module Node already imported exports, the cached instance; nothing for one `import` cannot read. */
async function exportsOf(url: string): Promise<Readonly<Record<string, unknown>>> {
  try {
    return await import(url);
  } catch {
    return {};
  }
}

function parsedOf(path: string): Readonly<Record<string, unknown>> | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    return typeof parsed === 'object' && parsed !== null ? { ...parsed } : undefined;
  } catch {
    return undefined;
  }
}

function isText(value: string | undefined): value is string {
  return value !== undefined;
}
