import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { importedModuleOf } from './imported.ts';

/** Where a root sits: a Service's or an Application's, or a Definitions Package's. */
export const rootFiles = ['src/contract/index.ts', 'src/definitions/index.ts'] as const;

/** Where a root sits in its project. */
export type RootFile = (typeof rootFiles)[number];

/** The names a root file exports its root under, one per kind of root. */
const rootExports = ['contract', 'application', 'definitions'] as const;

/** What a project's root file exports as its root, or why it could not be loaded. */
export type LoadedRoot =
  | { readonly kind: 'loaded'; readonly root: unknown }
  | { readonly kind: 'failed'; readonly message: string };

/**
 * Loads the root of the project in `directory` from the one root file it has; whether what it
 * exports is a valid root is the validation's to judge.
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
  const imported = await importedModuleOf(join(directory, file));
  if (imported.kind === 'failed') {
    return failed(`${file} cannot be loaded: ${imported.message}`);
  }
  const name = rootExports.find((exported) => imported.exports[exported] !== undefined);
  if (name === undefined) {
    return failed(`${file} exports none of ${rootExports.join(', ')}`);
  }
  return { kind: 'loaded', root: imported.exports[name] };
}

function failed(message: string): LoadedRoot {
  return { kind: 'failed', message };
}
