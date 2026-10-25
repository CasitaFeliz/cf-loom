import { realpathSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { byCodePoint } from '@cf-loom/contract/internal';
import { type Imported, importedModuleOf } from './imported.ts';
import {
  type PackageIdentity,
  type PackageManifest,
  packageIdentityOf,
  packageRootManifestOf,
} from './package-manifest.ts';

/** A module of a package the root's import reached, as Node resolved it: the instance the root holds. */
export type ImportedPackage = {
  /** The file URL Node resolved it to; specifiers resolving to one URL are one module. */
  readonly url: string;
  /** The package's root package.json's path: two installed copies of one name are two packages. */
  readonly manifestPath: string;
  readonly identity: PackageIdentity;
  /**
   * The first, in code point order, of the specifiers that are no relative path the project's own
   * files import it by, which a stub imports from; none when only other packages import it.
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

/** A specifier Node resolved to a file: the file that imports it and the file it resolved to. */
type Resolution = {
  readonly specifier: string;
  readonly parentUrl: string;
  readonly url: string;
};

/** What `importedBy` names the project's own files as. */
const projectImporter = 'project';

/**
 * Imports the root file of the project in `directory` while a resolve hook records every file Node
 * resolves an import to, whichever file imports it, so the packages are the ones Node chose,
 * through a package name or the package's own `imports` alike.
 */
export async function importedRootOf(path: string, directory: string): Promise<ImportedRoot> {
  const resolutions: Resolution[] = [];
  const hooks = registerHooks({
    resolve: (specifier, context, nextResolve) => {
      const resolved = nextResolve(specifier, context);
      const { parentURL } = context;
      if (parentURL?.startsWith('file:') && resolved.url.startsWith('file:')) {
        resolutions.push({ specifier, parentUrl: parentURL, url: resolved.url });
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

/** Every module of another package an import resolved to, with who imports it and by which specifier. */
async function importedPackagesOf(
  resolutions: readonly Resolution[],
  directory: string,
): Promise<readonly ImportedPackage[]> {
  const projectManifest = realpathSync(join(directory, 'package.json'));
  const rootOf = rootManifestsOf();
  const crossing = resolutions.filter(
    ({ parentUrl, url }) => rootOf(parentUrl)?.path !== rootOf(url)?.path,
  );
  const urls = [...new Set(crossing.map(({ url }) => url))].sort(byCodePoint);
  const packages: ImportedPackage[] = [];
  for (const url of urls) {
    const manifest = rootOf(url);
    if (manifest !== undefined && manifest.path !== projectManifest) {
      const reaching = crossing.filter((resolution) => resolution.url === url);
      const importers = reaching.map(({ parentUrl }) => rootOf(parentUrl)?.path);
      const fromProject = reaching.filter((_, index) => importers[index] === projectManifest);
      const named = fromProject.map((resolution) => resolution.specifier).filter(isNamed);
      const [specifier] = named.sort(byCodePoint);
      const importedBy = [...new Set(importers.filter(isText))]
        .map((path) => (path === projectManifest ? projectImporter : path))
        .sort(byCodePoint);
      const identity = packageIdentityOf(manifest, directory);
      const exports = await exportsOf(url);
      packages.push({ url, manifestPath: manifest.path, identity, specifier, importedBy, exports });
    }
  }
  return packages;
}

/** The package.json of the package each module or importer belongs to, read once per file. */
function rootManifestsOf(): (url: string) => PackageManifest | undefined {
  const manifests = new Map<string, PackageManifest | undefined>();
  return (url) => {
    if (!manifests.has(url)) {
      manifests.set(url, packageRootManifestOf(fileURLToPath(url)));
    }
    return manifests.get(url);
  };
}

/** What a module Node already imported exports, the cached instance; nothing for one `import` cannot read. */
async function exportsOf(url: string): Promise<Readonly<Record<string, unknown>>> {
  try {
    return await import(url);
  } catch {
    return {};
  }
}

/** A specifier a stub can import from too: a package name or one of the package's own `imports`, never a relative path. */
function isNamed(specifier: string): boolean {
  return !specifier.startsWith('.') && !specifier.startsWith('/') && !specifier.includes(':');
}

function isText(value: string | undefined): value is string {
  return value !== undefined;
}
