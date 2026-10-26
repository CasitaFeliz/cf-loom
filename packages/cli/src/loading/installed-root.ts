import { join } from 'node:path';
import { importedRootOf } from './imported-packages.ts';
import { type LoadedRoot, splitRoot } from './root.ts';

/** A package installed in the `node_modules` of `staging`, in `folder`; what its other imports resolve upward from starts at `staging`. */
export type InstalledPackage = {
  readonly staging: string;
  readonly folder: string;
  readonly packageName: string;
};

/**
 * Imports a package as a Service that installed it does: by its name, from the `node_modules` of
 * `staging`, through the entry Node resolves, with its own modules the root's, never another
 * package's.
 */
export async function installedRootOf({
  staging,
  folder,
  packageName,
}: InstalledPackage): Promise<LoadedRoot> {
  const target = { specifier: packageName, from: join(staging, 'installed.js') };
  const imported = await importedRootOf(target, join(folder, 'package.json'), staging);
  if (imported.kind === 'failed') {
    return { kind: 'failed', message: imported.message };
  }
  const split = splitRoot(imported.exports);
  if (split.kind === 'failed') {
    return { kind: 'failed', message: `its entry ${split.reason}` };
  }
  const { root, rootKind, exports } = split;
  return {
    kind: 'loaded',
    root,
    rootKind,
    file: packageName,
    exports,
    imported: imported.imported,
  };
}
