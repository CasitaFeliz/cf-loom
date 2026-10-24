import { join } from 'node:path';
import { byCodePoint } from '@cf-loom/contract/internal';
import { filesUnder } from './files-under.ts';
import { importedModuleOf } from './imported.ts';

/** Where the Contract's own files sit in a project. */
export const contractFolder = 'src/contract';

/**
 * Where a declaration is exported, under the name it is exported as: a file by its path relative
 * to the project, or a package by its name.
 */
export type ExportedAt =
  | { readonly kind: 'file'; readonly path: string; readonly name: string }
  | { readonly kind: 'package'; readonly packageName: string; readonly name: string };

/** A file of the Contract exporting a declaration. */
export type FileExport = Extract<ExportedAt, { readonly kind: 'file' }>;

/**
 * The files of the Contract that export each declaration, by identity, in code point order of
 * file and name; or the file that could not be imported.
 */
export type ContractExports =
  | {
      readonly kind: 'exported';
      readonly exportsOf: (declaration: unknown) => readonly FileExport[];
    }
  | { readonly kind: 'failed'; readonly message: string };

/**
 * Imports every `.ts` under `src/contract/`, through linked folders too, tests aside, so a stub
 * imports its declaration from where it is exported: Node gives each the instance the root holds.
 */
export async function contractExportsOf(directory: string): Promise<ContractExports> {
  const files = filesUnder(directory, contractFolder, { keeps: isContractSource });
  if (files.kind === 'failed') {
    return files;
  }
  const exportsByDeclaration = new Map<unknown, FileExport[]>();
  for (const path of [...files.files].sort(byCodePoint)) {
    const imported = await importedModuleOf(join(directory, path), directory);
    if (imported.kind === 'failed') {
      return { kind: 'failed', message: `${path} cannot be loaded: ${imported.message}` };
    }
    for (const name of namesOf(imported.exports)) {
      const declaration = imported.exports[name];
      const found = exportsByDeclaration.get(declaration) ?? [];
      found.push({ kind: 'file', path, name });
      exportsByDeclaration.set(declaration, found);
    }
  }
  return {
    kind: 'exported',
    exportsOf: (declaration) => exportsByDeclaration.get(declaration) ?? [],
  };
}

function isContractSource(file: string): boolean {
  return file.endsWith('.ts') && !file.endsWith('.test.ts') && !file.endsWith('.d.ts');
}

/** A module's named exports, in code point order. */
function namesOf(exports: Readonly<Record<string, unknown>>): readonly string[] {
  return Object.keys(exports)
    .filter((name) => name !== 'default')
    .sort(byCodePoint);
}
