import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  byCodePoint,
  exportNamesOf,
  isRoot,
  joinedOf,
  type Root,
} from '@cf-loom/contract/internal';
import { type ImportedPackage, importedRootOf } from './imported-packages.ts';
import { rootFiles, rootPlaces } from './roots.ts';

/**
 * What a project's Root file exports as its Root and the name it exports it under, the file,
 * everything else the file exports by name, which a Definitions Package shares, and every package
 * its import reached; or why it could not be loaded.
 */
export type LoadedRoot =
  | {
      readonly kind: 'loaded';
      readonly root: Root;
      readonly rootExportName: string;
      readonly file: string;
      readonly exports: Readonly<Record<string, unknown>>;
      readonly imported: readonly ImportedPackage[];
    }
  | { readonly kind: 'failed'; readonly message: string };

/**
 * Loads the Root of the project in `directory` from the one Root file it has, which exports one
 * Root under any name.
 */
export async function loadRoot(directory: string): Promise<LoadedRoot> {
  const present = rootFiles.filter((file) => existsSync(join(directory, file)));
  const [file, ...others] = present;
  if (file === undefined) {
    return failed(`No Root in ${joinedOf(rootFiles, 'or')}: run cf-loom init`);
  }
  if (others.length > 0) {
    return failed(`A project has one Root: both ${present.join(' and ')} exist`);
  }
  const path = join(directory, file);
  const target = { specifier: pathToFileURL(path).href, from: path };
  const imported = await importedRootOf(target, join(directory, 'package.json'), directory);
  if (imported.kind === 'failed') {
    return failed(`${file} cannot be loaded: ${imported.message}`);
  }
  const split = splitRoot(imported.exports);
  if (split.kind === 'failed') {
    return failed(`${file} ${split.reason}`);
  }
  const { root, rootExportName, exports } = split;
  return { kind: 'loaded', root, rootExportName, file, exports, imported: imported.imported };
}

/** What a Root file exports: the Root, the name it exports it under, and everything else by name; or why it exports no one Root. */
export type SplitRoot =
  | {
      readonly kind: 'split';
      readonly root: Root;
      readonly rootExportName: string;
      readonly exports: Readonly<Record<string, unknown>>;
    }
  | { readonly kind: 'failed'; readonly reason: string };

const { service, application, definitions } = rootPlaces;

const noRoot = [
  "exports no Root: a Service's Contract, an Application's Contract or a Definitions Package,",
  `declared with ${service.define}, ${application.define} or ${definitions.define}`,
].join(' ');

/**
 * Splits a Root file's exports into its Root, found among them by identity under any name, and
 * the rest. The Root is taken under the first of its names in code point order and its other
 * names stay among the rest, which a Definitions Package's rule judges.
 */
export function splitRoot(exported: Readonly<Record<string, unknown>>): SplitRoot {
  const roots = rootsAmong(exported);
  const [first, ...more] = roots;
  if (first === undefined) {
    return { kind: 'failed', reason: noRoot };
  }
  if (more.length > 0) {
    const names = roots.map(({ name }) => name);
    return { kind: 'failed', reason: `exports more than one Root: ${joinedOf(names, 'and')}` };
  }
  const { [first.name]: _root, ...exports } = exported;
  return { kind: 'split', root: first.root, rootExportName: first.name, exports };
}

/** Each distinct Root among the exports with the first name it is exported under, in code point order of that name. */
function rootsAmong(
  exported: Readonly<Record<string, unknown>>,
): readonly { readonly root: Root; readonly name: string }[] {
  const roots: { readonly root: Root; readonly name: string }[] = [];
  for (const root of new Set(Object.values(exported).filter(isRoot))) {
    const [name] = exportNamesOf(exported, root);
    if (name !== undefined) {
      roots.push({ root, name });
    }
  }
  return roots.sort((left, right) => byCodePoint(left.name, right.name));
}

function failed(message: string): LoadedRoot {
  return { kind: 'failed', message };
}
