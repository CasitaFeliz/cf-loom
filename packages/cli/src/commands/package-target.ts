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
import { basename, dirname, join, resolve } from 'node:path';
import type { PackageFile } from '../contract-package/index.ts';
import { oneLineOf } from '../loading/index.ts';
import { done, type Exit, toolingError } from './exit.ts';

/** What sits where the package is to be written. */
type Target = 'missing' | 'empty' | 'previous-output' | 'other-files' | 'no-folder' | 'link';

/** What a folder `package` wrote may hold: what it writes, and the `dist/` a build adds. */
const outputEntries: ReadonlySet<string> = new Set([
  'package.json',
  'snapshot.json',
  'tsconfig.json',
  'src',
  'dist',
]);

/**
 * Writes the Contract Package to `out`, relative to the project: a missing or empty folder, or a
 * previous output, which is replaced whole; anything else is refused and left as it was. The
 * files are written beside it first, so a failed write leaves the target untouched.
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
 * A folder `package` wrote: it holds only what `package` writes and a build adds, and its
 * package.json carries the `cfLoom` metadata.
 */
function isPreviousOutput(target: string): boolean {
  if (readdirSync(target).some((entry) => !outputEntries.has(entry))) {
    return false;
  }
  try {
    const manifest: unknown = JSON.parse(readFileSync(join(target, 'package.json'), 'utf8'));
    return typeof manifest === 'object' && manifest !== null && 'cfLoom' in manifest;
  } catch {
    return false;
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
