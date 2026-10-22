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
import {
  builtFolder,
  isPackageManifest,
  isPackagePath,
  type PackageFile,
  packagePaths,
} from '../contract-package/index.ts';
import { oneLineOf } from '../loading/index.ts';

/** What sits where the package is to be written. */
type Target = 'missing' | 'empty' | 'previous-output' | 'other-files' | 'no-folder' | 'link';

/** The package written; the target refused as it is; or a read or write that failed, in one line. */
export type PackageWrite =
  | { readonly kind: 'written' }
  | { readonly kind: 'refused'; readonly message: string }
  | { readonly kind: 'failed'; readonly message: string };

/** The folders a previous output keeps as they are: a build's and an install's. */
const keptFolders: readonly string[] = [builtFolder, 'node_modules'];

/**
 * Writes the Contract Package to `out`, relative to the project: a missing or empty folder, or a
 * previous output, whose files are replaced, its install and build kept; anything else is
 * refused and left as it was.
 */
export function writeContractPackageTo(
  directory: string,
  out: string,
  files: readonly PackageFile[],
): PackageWrite {
  const target = resolve(directory, out);
  let found: Target;
  try {
    found = targetOf(target);
  } catch (e) {
    return { kind: 'failed', message: `${out} cannot be read: ${oneLineOf(e, directory)}` };
  }
  switch (found) {
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
      return replaced(directory, { out, target, found }, files);
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
 * and its package.json is one `package` wrote.
 */
function isPreviousOutput(target: string): boolean {
  if (!filesOutsideKeptOf(target).every(isPackagePath)) {
    return false;
  }
  const manifestPath = join(target, packagePaths.manifest);
  if (!existsSync(manifestPath)) {
    return false;
  }
  try {
    return isPackageManifest(JSON.parse(readFileSync(manifestPath, 'utf8')));
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

/** Where the package goes, as given and resolved, and what was found there. */
type Destination = { readonly out: string; readonly target: string; readonly found: Target };

/**
 * Writes the files beside the target, then puts them in place so an interrupted run leaves a
 * target a rerun accepts: a missing or empty target is the written folder renamed into place; a
 * previous output keeps its package.json until the new one is renamed over it, last, and its
 * kept folders are never moved.
 */
function replaced(
  directory: string,
  { out, target, found }: Destination,
  files: readonly PackageFile[],
): PackageWrite {
  let staging: string | undefined;
  try {
    mkdirSync(dirname(target), { recursive: true });
    staging = mkdtempSync(join(dirname(target), `.${basename(target)}-`));
    writeAll(staging, files);
    if (found === 'previous-output') {
      clearOwnFiles(target);
      moveEntries(staging, target);
    } else {
      rmSync(target, { recursive: true, force: true });
      renameSync(staging, target);
    }
    return { kind: 'written' };
  } catch (e) {
    return { kind: 'failed', message: `${out} cannot be written: ${oneLineOf(e, directory)}` };
  } finally {
    if (staging !== undefined) {
      rmSync(staging, { recursive: true, force: true });
    }
  }
}

/** Writes each file under the folder, creating the folders between. */
export function writeAll(folder: string, files: readonly PackageFile[]): void {
  for (const { path, text } of files) {
    mkdirSync(dirname(join(folder, path)), { recursive: true });
    writeFileSync(join(folder, path), text);
  }
}

/** Removes the target's own files, its package.json aside, which the new one replaces in place. */
function clearOwnFiles(target: string): void {
  const own = readdirSync(target).filter(
    (entry) => !keptFolders.includes(entry) && entry !== packagePaths.manifest,
  );
  for (const entry of own) {
    rmSync(join(target, entry), { recursive: true, force: true });
  }
}

/** Moves every new entry in, the package.json last, renamed over the old one at once. */
function moveEntries(from: string, to: string): void {
  const entries = readdirSync(from).filter((entry) => entry !== packagePaths.manifest);
  for (const entry of [...entries, packagePaths.manifest]) {
    renameSync(join(from, entry), join(to, entry));
  }
}
