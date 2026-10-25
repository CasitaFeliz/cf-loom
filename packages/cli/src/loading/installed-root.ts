import { join } from 'node:path';
import { importedRootOf } from './imported-packages.ts';
import { type LoadedRoot, splitRoot } from './root.ts';

/**
 * Imports a package as a Service that installed it does: by its name, from the `node_modules` of
 * `staging`, through its `exports`, with its own modules the root's, never another package's.
 * `staging` is where the files of any other package it imports resolve upward from.
 */
export async function installedRootOf(staging: string, packageName: string): Promise<LoadedRoot> {
  const target = { specifier: packageName, from: join(staging, 'installed.js') };
  const manifest = join(staging, 'node_modules', packageName, 'package.json');
  const imported = await importedRootOf(target, manifest, staging);
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
