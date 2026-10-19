import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import type { PackageFile } from '../contract-package/index.ts';
import { oneLineOf } from '../loading/index.ts';
import { done, type Exit, toolingError } from './exit.ts';

/** What sits where the package is to be written. */
type Target = 'missing' | 'empty' | 'previous-output' | 'other-files' | 'no-folder' | 'link';

/** The folders a previous output keeps as they are: a build's `dist/` and an install's `node_modules/`. */
const keptFolders: readonly string[] = ['dist', 'node_modules'];

/** The paths of the files `package` writes, in any Contract Package. */
const writtenPath =
  /^(package|snapshot|tsconfig)\.json$|^src\/(index|snapshot|standard-rejections|defs)\.ts$|^src\/(endpoints|guards|rejections)\/[^/]+\.ts$/;

/**
 * Writes the Contract Package to `out`, relative to the project: a missing or empty folder, or a
 * previous output, whose files are replaced, its build and install kept; anything else is
 * refused and left as it was. The files are written beside it first.
 */
export function writeContractPackageTo(
  directory: string,
  out: string,
  files: readonly PackageFile[],
): Exit {
  const target = resolve(directory, out);
  switch (targetOf(target)) {
    case 'other-files':
      return toolingError(
        `${out} holds files package did not write: package writes to a missing or empty folder, or over its own output`,
      );
    case 'no-folder':
      return toolingError(`${out} is no folder: package writes a folder`);
    case 'link':
      return toolingError(`${out} is a symbolic link: package writes a folder of its own`);
    case 'missing':
    case 'empty':
    case 'previous-output':
      return replaced(directory, { out, target }, files);
  }
}

function targetOf(target: string): Target {
  if (isLink(target)) {
    return 'link';
  }
  if (!existsSync(target)) {
    return 'missing';
  }
  if (!statSync(target).isDirectory()) {
    return 'no-folder';
  }
  if (readdirSync(target).length === 0) {
    return 'empty';
  }
  return isPreviousOutput(target) ? 'previous-output' : 'other-files';
}

function isLink(target: string): boolean {
  try {
    return lstatSync(target).isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * A folder `package` wrote: outside the folders it keeps, every file is one `package` writes,
 * and its package.json carries the `cfLoom` metadata.
 */
function isPreviousOutput(target: string): boolean {
  if (!filesOutsideKeptOf(target).every((path) => writtenPath.test(path))) {
    return false;
  }
  try {
    const manifest: unknown = JSON.parse(readFileSync(join(target, 'package.json'), 'utf8'));
    return typeof manifest === 'object' && manifest !== null && 'cfLoom' in manifest;
  } catch {
    return false;
  }
}

/** Every file of a folder outside the folders a previous output keeps, by its path in it. */
function filesOutsideKeptOf(target: string): readonly string[] {
  const top = readdirSync(target, { withFileTypes: true });
  const searched = top.filter(({ name }) => !keptFolders.includes(name));
  return searched.flatMap((entry) => {
    if (!entry.isDirectory()) {
      return [entry.name];
    }
    const inside = readdirSync(join(target, entry.name), { recursive: true, withFileTypes: true });
    return inside
      .filter((found) => !found.isDirectory())
      .map((found) => relative(target, join(found.parentPath, found.name)).split(sep).join('/'));
  });
}

/** Moves the folders a previous output keeps into the package written beside it. */
function keepFolders(target: string, staging: string): void {
  for (const folder of keptFolders) {
    if (existsSync(join(target, folder))) {
      renameSync(join(target, folder), join(staging, folder));
    }
  }
}

function replaced(
  directory: string,
  { out, target }: { readonly out: string; readonly target: string },
  files: readonly PackageFile[],
): Exit {
  let staging: string | undefined;
  try {
    mkdirSync(dirname(target), { recursive: true });
    staging = mkdtempSync(join(dirname(target), `.${basename(target)}-`));
    for (const { path, text } of files) {
      mkdirSync(dirname(join(staging, path)), { recursive: true });
      writeFileSync(join(staging, path), text);
    }
    if (existsSync(target)) {
      keepFolders(target, staging);
    }
    rmSync(target, { recursive: true, force: true });
    renameSync(staging, target);
    return done([`Wrote ${out}`]);
  } catch (e) {
    if (staging !== undefined) {
      rmSync(staging, { recursive: true, force: true });
    }
    return toolingError(`${out} cannot be written: ${oneLineOf(e, directory)}`);
  }
}
