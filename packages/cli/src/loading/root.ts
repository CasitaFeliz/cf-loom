import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { importedModuleOf } from './imported.ts';
import { rootFiles, rootPlaces } from './roots.ts';

/** The names a root file may export its root under. */
const rootExports = [...new Set(Object.values(rootPlaces).map(({ exported }) => exported))];

/** What a project's root file exports as its root, and the file, or why it could not be loaded. */
export type LoadedRoot =
  | { readonly kind: 'loaded'; readonly root: unknown; readonly file: string }
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
  const names = rootExports.filter((exported) => imported.exports[exported] !== undefined);
  const [name, ...more] = names;
  if (name === undefined) {
    return failed(`${file} exports none of ${rootExports.join(', ')}`);
  }
  if (more.length > 0) {
    return failed(`${file} exports one root, not ${names.join(' and ')}`);
  }
  return { kind: 'loaded', root: imported.exports[name], file };
}

function failed(message: string): LoadedRoot {
  return { kind: 'failed', message };
}
