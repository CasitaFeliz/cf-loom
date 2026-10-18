import { globSync } from 'node:fs';
import { join } from 'node:path';
import { byCodePoint } from '@casitafeliz/loom-contract/internal';
import { importedModuleOf } from './imported.ts';

/** Where the Contract's own files sit in a project. */
const contractFolder = 'src/contract';

/**
 * Where a declaration is exported: a file by its path relative to the project, starting with
 * `./`, or a package by its name, and the name it is exported under.
 */
export type ExportedAt = { readonly specifier: string; readonly name: string };

/** Where each declaration is exported, by identity, or the file that could not be imported. */
export type Exported =
  | {
      readonly kind: 'exported';
      readonly exportedAt: (declaration: unknown) => ExportedAt | undefined;
    }
  | { readonly kind: 'failed'; readonly message: string };

/** A package whose `.` entry may export declarations, by its name, with its exports by name. */
export type ExportingPackage = {
  readonly packageName: string;
  readonly exports: Readonly<Record<string, unknown>>;
};

/**
 * Finds where each declaration is exported, by identity, so a stub imports it from there: every
 * `.ts` under `src/contract/` but tests, each file and named export taken in code point order,
 * then each listed package's `.` entry; the first place wins.
 */
export async function exportedOf(
  directory: string,
  packages: readonly ExportingPackage[],
): Promise<Exported> {
  const places = new Map<unknown, ExportedAt>();
  for (const file of contractFilesOf(directory)) {
    const imported = await importedModuleOf(join(directory, file), directory);
    if (imported.kind === 'failed') {
      return { kind: 'failed', message: `${file} cannot be loaded: ${imported.message}` };
    }
    addPlaces(places, `./${file}`, imported.exports);
  }
  for (const { packageName, exports } of packages) {
    addPlaces(places, packageName, exports);
  }
  return { kind: 'exported', exportedAt: (declaration) => places.get(declaration) };
}

function contractFilesOf(directory: string): readonly string[] {
  const files = globSync(`${contractFolder}/**/*.ts`, { cwd: directory });
  const posixFiles = files.map((file) => file.split('\\').join('/'));
  return posixFiles.filter(isContractSource).sort(byCodePoint);
}

function isContractSource(file: string): boolean {
  return !file.endsWith('.test.ts') && !file.endsWith('.d.ts');
}

function addPlaces(
  places: Map<unknown, ExportedAt>,
  specifier: string,
  exports: Readonly<Record<string, unknown>>,
): void {
  const names = Object.keys(exports).filter((name) => name !== 'default');
  for (const name of names.sort(byCodePoint)) {
    const declaration = exports[name];
    if (!places.has(declaration)) {
      places.set(declaration, { specifier, name });
    }
  }
}
