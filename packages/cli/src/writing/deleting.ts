import { unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { oneLineOf } from '../loading/index.ts';

/** The files deleted, or the file a deletion stopped at, in one line. */
export type Deleted =
  | { readonly kind: 'deleted'; readonly paths: readonly string[] }
  | { readonly kind: 'failed'; readonly message: string };

/** Deletes each file, relative to the project, in order; a rerun finds what a failure left. */
export function deleteFiles(directory: string, paths: readonly string[]): Deleted {
  for (const path of paths) {
    try {
      unlinkSync(join(directory, path));
    } catch (e) {
      return { kind: 'failed', message: `${path} cannot be deleted: ${oneLineOf(e, directory)}` };
    }
  }
  return { kind: 'deleted', paths };
}
