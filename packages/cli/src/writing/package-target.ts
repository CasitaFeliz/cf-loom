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
import { isPackagePath, type PackageFile } from '../contract-package/index.ts';
import { oneLineOf } from '../loading/index.ts';

/** What sits where the package is to be written. */
type Target = 'missing' | 'empty' | 'previous-output' | 'other-files' | 'no-folder' | 'link';

/** The package written, or why not, in one line. */
export type PackageWrite =
  | { readonly kind: 'written' }
  | { readonly kind: 'refused'; readonly message: string };

/** The folders a previous output keeps as they are: a build's `dist/` and an install's `node_modules/`. */
const keptFolders: readonly string[] = ['dist', 'node_modules'];

/**
 * Writes the Contract Package to `out`, relative to the project: a missing or empty folder, or a
 * previous output, whose files are replaced, its build and install kept; anything else is
 * refused and left as it was.
 */
export function writeContractPackageTo(
  directory: string,
  out: string,
  files: readonly PackageFile[],
): PackageWrite {
  const target = resolve(directory, out);
  switch (targetOf(target)) {
    case 'other-files':
      return refused(
        `${out} holds files package did not write: package writes to a missing or empty folder, or over its own output`,
      );
    case 'no-folder':
      return refused(`${out} is no folder: package writes a folder`);
    case 'link':
      return refused(`${out} is a symbolic link: package writes a folder of its own`);
    case 'missing':
    case 'empty':
    case 'previous-output':
      return replaced(directory, { out, target }, files);
  }
}

function refused(message: string): PackageWrite {
  return { kind: 'refused', message };
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
  if (!filesOutsideKeptOf(target).every(isPackagePath)) {
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

/**
 * Writes the files beside the target, then clears the target's own files, `package.json` last
 * so an interrupted run is still a previous output, and moves the new ones in: the kept folders
 * are never moved, so no failure can lose them.
 */
function replaced(
  directory: string,
  { out, target }: { readonly out: string; readonly target: string },
  files: readonly PackageFile[],
): PackageWrite {
  let staging: string | undefined;
  try {
    mkdirSync(dirname(target), { recursive: true });
    staging = mkdtempSync(join(dirname(target), `.${basename(target)}-`));
    writeAll(staging, files);
    mkdirSync(target, { recursive: true });
    clearOwnFiles(target);
    moveEntries(staging, target);
    return { kind: 'written' };
  } catch (e) {
    return refused(`${out} cannot be written: ${oneLineOf(e, directory)}`);
  } finally {
    if (staging !== undefined) {
      rmSync(staging, { recursive: true, force: true });
    }
  }
}

function writeAll(folder: string, files: readonly PackageFile[]): void {
  for (const { path, text } of files) {
    mkdirSync(dirname(join(folder, path)), { recursive: true });
    writeFileSync(join(folder, path), text);
  }
}

function clearOwnFiles(target: string): void {
  const own = readdirSync(target).filter((entry) => !keptFolders.includes(entry));
  const ordered = [
    ...own.filter((entry) => entry !== 'package.json'),
    ...own.filter((entry) => entry === 'package.json'),
  ];
  for (const entry of ordered) {
    rmSync(join(target, entry), { recursive: true, force: true });
  }
}

function moveEntries(from: string, to: string): void {
  for (const entry of readdirSync(from)) {
    renameSync(join(from, entry), join(to, entry));
  }
}
