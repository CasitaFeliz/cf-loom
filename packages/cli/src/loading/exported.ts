import { realpathSync } from 'node:fs';
import { join, sep } from 'node:path';
import { byCodePoint } from '@cf-loom/contract/internal';
import { filesUnder } from './files-under.ts';
import { importedModuleOf } from './imported.ts';

/** Where the Contract's own files sit in a project. */
export const contractFolder = 'src/contract';

/** Whether a path the layout gives, from the project's directory, lies under the Contract's folder. */
export function isUnderContract(path: string): boolean {
  return path.startsWith(`${contractFolder}/`);
}

/**
 * Whether a folder, by its real path, is the project's Contract folder or inside it, whichever
 * link led to it, so a search of `src/` never reads what a link into the Contract reaches.
 */
export function insideContractOf(directory: string): (realFolder: string) => boolean {
  try {
    const contract = realpathSync(join(directory, contractFolder));
    return (realFolder) => realFolder === contract || realFolder.startsWith(`${contract}${sep}`);
  } catch {
    return () => false;
  }
}

/**
 * Where a declaration is exported, under the name it is exported as: a file by its path relative
 * to the project, or a package by its name.
 */
export type ExportedAt =
  | { readonly kind: 'file'; readonly path: string; readonly name: string }
  | { readonly kind: 'package'; readonly packageName: string; readonly name: string };

/** A file of the Contract exporting a declaration. */
export type FileExport = Extract<ExportedAt, { readonly kind: 'file' }>;

/** A file of the Contract exporting a value under a name. */
export type ExportedValue = FileExport & { readonly value: unknown };

/** The files of the Contract that export a declaration, by identity, in code point order of file and name. */
export type ExportsOf = (declaration: unknown) => readonly FileExport[];

/**
 * What `src/contract/` exports: every export in code point order of file and name, and where a
 * declaration is exported; or the file that could not be imported.
 */
export type ContractExports =
  | {
      readonly kind: 'exported';
      readonly exports: readonly ExportedValue[];
      readonly exportsOf: ExportsOf;
    }
  | { readonly kind: 'failed'; readonly message: string };

/**
 * Imports every `.ts` under `src/contract/`, through linked folders too, tests aside, so a stub
 * and the readers file import a declaration from where it is exported: Node gives each the
 * instance the root holds.
 */
export async function contractExportsOf(directory: string): Promise<ContractExports> {
  const files = filesUnder(directory, contractFolder, { keeps: isContractSource });
  if (files.kind === 'failed') {
    return files;
  }
  const exports: ExportedValue[] = [];
  for (const path of [...files.files].sort(byCodePoint)) {
    const imported = await importedModuleOf(join(directory, path), directory);
    if (imported.kind === 'failed') {
      return { kind: 'failed', message: `${path} cannot be loaded: ${imported.message}` };
    }
    for (const name of namesOf(imported.exports)) {
      exports.push({ kind: 'file', path, name, value: imported.exports[name] });
    }
  }
  return {
    kind: 'exported',
    exports,
    exportsOf: (declaration) => exports.filter(({ value }) => value === declaration),
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
