import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { PackageFile } from '../contract-package/index.ts';
import { oneLineOf } from '../loading/index.ts';
import { writeAll } from './package-target.ts';

/** Where a package is staged to be built and published, in the project's `node_modules`, so its peers resolve. */
const stagingParent = join('node_modules', '.cache', 'cf-loom');

/** A file of the project to publish as it is, by its path in the project and in the package. */
export type CopiedFile = { readonly from: string; readonly path: string };

/** The folder a package was staged in, or why it could not be. */
export type Staged =
  | { readonly kind: 'staged'; readonly folder: string }
  | { readonly kind: 'failed'; readonly message: string };

/**
 * Stages a package in a new folder of the project's staging place: the files copied, then the
 * files given over them. The folder is removed with `removeStaged`, and by this function when
 * it fails.
 */
export function stagedIn(
  directory: string,
  files: readonly PackageFile[],
  copied: readonly CopiedFile[],
): Staged {
  const parent = join(directory, stagingParent);
  let folder: string | undefined;
  try {
    mkdirSync(parent, { recursive: true });
    folder = mkdtempSync(join(parent, 'publish-'));
    copyAll(folder, copied);
    writeAll(folder, files);
    return { kind: 'staged', folder };
  } catch (e) {
    if (folder !== undefined) {
      removeStaged(folder);
    }
    return {
      kind: 'failed',
      message: `${stagingParent} cannot be written: ${oneLineOf(e, directory)}`,
    };
  }
}

/** Removes a folder `stagedIn` made, and what was built in it. */
export function removeStaged(folder: string): void {
  rmSync(folder, { recursive: true, force: true });
}

function copyAll(folder: string, copied: readonly CopiedFile[]): void {
  for (const { from, path } of copied) {
    mkdirSync(dirname(join(folder, path)), { recursive: true });
    copyFileSync(from, join(folder, path));
  }
}
