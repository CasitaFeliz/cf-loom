import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { PackageFile } from '../contract-package/index.ts';
import { type InstalledPackage, oneLineOf } from '../loading/index.ts';
import { writeAll } from './package-target.ts';

/** Where a package is staged to be built and published, in the project's `node_modules`, so its peers resolve. */
const stagingParent = 'node_modules/.cache/cf-loom';

/** A file of the project to publish as it is, by its path in the project and in the package. */
export type CopiedFile = { readonly from: string; readonly path: string };

/** What a package is staged from: the files written, and the files of the project copied as they are. */
type StagedContent = {
  readonly files: readonly PackageFile[];
  readonly copied: readonly CopiedFile[];
};

/**
 * Where a package was staged, or why it could not be and the lines naming a folder it could not
 * remove. `folder` is the package, which `npm publish` and `tsc` get; it sits under `staging` in
 * a `node_modules`, so Node finds it as it finds an installed package.
 */
export type Staged =
  | ({ readonly kind: 'staged' } & InstalledPackage)
  | { readonly kind: 'failed'; readonly message: string; readonly left: readonly string[] };

/**
 * Stages a package in `node_modules/<its name>` of a new folder of the project's staging place:
 * the files copied, then the files given over them. The folder is removed with `removeStaged`,
 * and by this function when it fails, which names it if it stays.
 */
export function stagedIn(directory: string, packageName: string, content: StagedContent): Staged {
  const parent = join(directory, stagingParent);
  let staging: string | undefined;
  try {
    mkdirSync(parent, { recursive: true });
    staging = mkdtempSync(join(parent, 'publish-'));
    const folder = join(staging, 'node_modules', packageName);
    mkdirSync(folder, { recursive: true });
    copyAll(folder, content.copied);
    writeAll(folder, content.files);
    return { kind: 'staged', staging, folder, packageName };
  } catch (e) {
    const message = `${stagingParent} cannot be written: ${oneLineOf(e, directory)}`;
    const left = staging === undefined ? [] : removeStaged(staging, directory);
    return { kind: 'failed', message, left };
  }
}

/** Removes a staging folder `stagedIn` made, and what was built in it; a folder that stays is named in a line, never thrown. */
export function removeStaged(staging: string, directory: string): readonly string[] {
  try {
    rmSync(staging, { recursive: true, force: true });
    return [];
  } catch (e) {
    const left = `${stagingParent}/${basename(staging)} was left behind: ${oneLineOf(e, directory)}`;
    return [`${left}: delete it`];
  }
}

function copyAll(folder: string, copied: readonly CopiedFile[]): void {
  for (const { from, path } of copied) {
    mkdirSync(dirname(join(folder, path)), { recursive: true });
    copyFileSync(from, join(folder, path));
  }
}
