import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { importedModuleOf } from './imported.ts';
import { type RootKind, rootFiles, rootKinds, rootPlaces } from './roots.ts';

/**
 * What a project's root file exports as its root, the kind of root it is, the file, and everything
 * the file exports, which a Definitions Package lists; or why it could not be loaded.
 */
export type LoadedRoot =
  | {
      readonly kind: 'loaded';
      readonly root: unknown;
      readonly rootKind: RootKind;
      readonly file: string;
      readonly exports: readonly unknown[];
    }
  | { readonly kind: 'failed'; readonly message: string };

/**
 * Loads the root of the project in `directory` from the one root file it has, exported under one
 * name; whether what it exports is a valid root is the validation's to judge.
 */
export async function loadRoot(directory: string): Promise<LoadedRoot> {
  const present = rootFiles.filter((file) => existsSync(join(directory, file)));
  const [file, ...others] = present;
  if (file === undefined) {
    return failed(`No root in ${rootFiles.join(' or ')}: run cf-loom init`);
  }
  if (others.length > 0) {
    return failed(`A project has one root: both ${present.join(' and ')} exist`);
  }
  const imported = await importedModuleOf(join(directory, file), directory);
  if (imported.kind === 'failed') {
    return failed(`${file} cannot be loaded: ${imported.message}`);
  }
  const kinds = rootKinds.filter(
    (rootKind) => imported.exports[exportedAs(rootKind)] !== undefined,
  );
  const [rootKind, ...more] = kinds;
  if (rootKind === undefined) {
    return failed(`${file} exports none of ${rootKinds.map(exportedAs).join(', ')}`);
  }
  if (more.length > 0) {
    return failed(`${file} exports one root, not ${kinds.map(exportedAs).join(' and ')}`);
  }
  const exports = Object.values(imported.exports);
  return { kind: 'loaded', root: imported.exports[exportedAs(rootKind)], rootKind, file, exports };
}

function exportedAs(rootKind: RootKind): string {
  return rootPlaces[rootKind].exported;
}

function failed(message: string): LoadedRoot {
  return { kind: 'failed', message };
}
