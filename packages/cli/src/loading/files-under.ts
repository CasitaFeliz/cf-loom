import { existsSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/**
 * Every file under a folder of a project that a test of its path keeps, by its path relative to
 * the project with `/` between segments, through symbolic links to folders too, each real
 * folder once, so a link back up ends.
 */
export function filesUnder(
  directory: string,
  folder: string,
  isWanted: (path: string) => boolean,
): readonly string[] {
  const start = join(directory, folder);
  if (!existsSync(start) || !statSync(start).isDirectory()) {
    return [];
  }
  const found: string[] = [];
  const visited = new Set<string>();
  const pending = [start];
  for (let current = pending.pop(); current !== undefined; current = pending.pop()) {
    const real = realpathSync(current);
    if (visited.has(real)) {
      continue;
    }
    visited.add(real);
    for (const name of readdirSync(current)) {
      const path = join(current, name);
      const stats = statOf(path);
      if (stats === 'folder') {
        pending.push(path);
      }
      const projectPath = relative(directory, path).split(sep).join('/');
      if (stats === 'file' && isWanted(projectPath)) {
        found.push(projectPath);
      }
    }
  }
  return found;
}

/** What a path is once links are followed: a folder, a file, or neither (a dangling link). */
function statOf(path: string): 'folder' | 'file' | 'other' {
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
