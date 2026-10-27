import { unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { oneLineOf } from '../loading/index.ts';

/** The files deleted, or the file a deletion stopped at, in one line, with the files deleted before it. */
export type Deleted =
  | { readonly kind: 'deleted'; readonly paths: readonly string[] }
  | { readonly kind: 'failed'; readonly message: string; readonly paths: readonly string[] };

/** Deletes each file, relative to the project, in order; a rerun finds what a failure left. */
export function deleteFiles(directory: string, paths: readonly string[]): Deleted {
  const deleted: string[] = [];
  for (const path of paths) {
    try {
      unlinkSync(join(directory, path));
    } catch (e) {
      const message = `${path} cannot be deleted: ${oneLineOf(e, directory)}`;
      return { kind: 'failed', message, paths: deleted };
    }
    deleted.push(path);
  }
  return { kind: 'deleted', paths: deleted };
}
