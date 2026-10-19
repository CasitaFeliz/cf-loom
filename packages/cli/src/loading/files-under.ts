import { readdirSync, realpathSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { oneLineOf } from './imported.ts';

/** The files found under a folder, or the folder that could not be read, in one line. */
export type FilesUnder =
  | { readonly kind: 'files'; readonly files: readonly string[] }
  | { readonly kind: 'failed'; readonly message: string };

/**
 * Every file under a folder of a project that a test of its path keeps, by its path relative to
 * the project with `/` between segments, through symbolic links to folders too, each real
 * folder once, so a link back up ends.
 */
export function filesUnder(
  directory: string,
  folder: string,
  isWanted: (path: string) => boolean,
): FilesUnder {
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
      const kind = kindOf(path);
      const projectPath = projectPathOf(directory, path);
      if (kind === 'folder') {
        pending.push(path);
      } else if (kind === 'file' && isWanted(projectPath)) {
        files.push(projectPath);
      }
    }
  }
  return { kind: 'files', files };
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
