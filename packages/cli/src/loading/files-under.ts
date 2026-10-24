import { readdirSync, realpathSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { oneLineOf } from './imported.ts';

/** The files found under a folder, or the folder that could not be read, in one line. */
export type FilesUnder =
  | { readonly kind: 'files'; readonly files: readonly string[] }
  | { readonly kind: 'failed'; readonly message: string };

/** Which files of a folder are found, and which of its folders are never entered, by path. */
export type FileFilter = {
  /** Whether a file, by its path relative to the project, is found. */
  readonly keeps: (path: string) => boolean;
  /** Whether a folder, by its real path, is never read; none by default. */
  readonly skips?: (realPath: string) => boolean;
};

/**
 * Every file under a folder of a project that the filter keeps, by its path relative to the
 * project with `/` between segments, through symbolic links to folders too, each real folder
 * once, so a link back up ends; a folder the filter skips is never read, however a link led to it.
 */
export function filesUnder(directory: string, folder: string, filter: FileFilter): FilesUnder {
  const start = join(directory, folder);
  if (kindOf(start) !== 'folder') {
    return { kind: 'files', files: [] };
  }
  const files: string[] = [];
  const visited = new Set<string>();
  const pending = [start];
  for (let current = pending.pop(); current !== undefined; current = pending.pop()) {
    const read = entriesOf(current, directory);
    if (read.kind === 'failed') {
      return read;
    }
    if (visited.has(read.real)) {
      continue;
    }
    visited.add(read.real);
    for (const name of read.names) {
      const path = join(current, name);
      const kind = searchedKindOf(path, filter);
      const projectPath = projectPathOf(directory, path);
      if (kind === 'folder') {
        pending.push(path);
      } else if (kind === 'file' && filter.keeps(projectPath)) {
        files.push(projectPath);
      }
    }
  }
  return { kind: 'files', files };
}

/** What a path is to the search: a folder it enters, a file, or neither, a skipped folder being neither. */
function searchedKindOf(path: string, filter: FileFilter): 'folder' | 'file' | 'other' {
  const kind = kindOf(path);
  return kind === 'folder' && isSkipped(path, filter) ? 'other' : kind;
}

/** Whether the filter skips a folder; one whose real path cannot be told is read, and reports why. */
function isSkipped(folder: string, filter: FileFilter): boolean {
  if (filter.skips === undefined) {
    return false;
  }
  try {
    return filter.skips(realpathSync(folder));
  } catch {
    return false;
  }
}

/** A folder's real path and the names in it, or why it cannot be read. */
function entriesOf(
  folder: string,
  directory: string,
):
  | { readonly kind: 'read'; readonly real: string; readonly names: readonly string[] }
  | { readonly kind: 'failed'; readonly message: string } {
  try {
    return { kind: 'read', real: realpathSync(folder), names: readdirSync(folder) };
  } catch (e) {
    const message = `${projectPathOf(directory, folder)} cannot be read: ${oneLineOf(e, directory)}`;
    return { kind: 'failed', message };
  }
}

function projectPathOf(directory: string, path: string): string {
  return relative(directory, path).split(sep).join('/');
}

/** What a path is once links are followed: a folder, a file, or neither (a dangling link). */
function kindOf(path: string): 'folder' | 'file' | 'other' {
  try {
    const stats = statSync(path);
    if (stats.isDirectory()) {
      return 'folder';
    }
    return stats.isFile() ? 'file' : 'other';
  } catch {
    return 'other';
  }
}
