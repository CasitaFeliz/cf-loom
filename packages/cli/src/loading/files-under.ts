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
  /** Whether a folder, by its path relative to the project, is never entered; none by default. */
  readonly skips?: (path: string) => boolean;
};

/**
 * Every file under a folder of a project that the filter keeps, by its path relative to the
 * project with `/` between segments, through symbolic links to folders too, each real folder
 * once, so a link back up ends; a folder the filter skips is never read.
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
      const projectPath = projectPathOf(directory, path);
      const found = foundAt(kindOf(path), projectPath, filter);
      if (found === 'folder') {
        pending.push(path);
      } else if (found === 'file') {
        files.push(projectPath);
      }
    }
  }
  return { kind: 'files', files };
}

/** What the search finds at a path: a folder to enter, a file it keeps, or nothing. */
function foundAt(
  kind: 'folder' | 'file' | 'other',
  projectPath: string,
  filter: FileFilter,
): 'folder' | 'file' | 'nothing' {
  switch (kind) {
    case 'folder':
      return filter.skips?.(projectPath) === true ? 'nothing' : 'folder';
    case 'file':
      return filter.keeps(projectPath) ? 'file' : 'nothing';
    case 'other':
      return 'nothing';
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
