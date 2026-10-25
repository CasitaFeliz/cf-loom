import { realpathSync } from 'node:fs';
import { join } from 'node:path';

/** A project path's real path, links followed, or the path itself where nothing resolves. */
export function realPathOf(directory: string, path: string): string {
  const absolute = join(directory, path);
  try {
    return realpathSync(absolute);
  } catch {
    return absolute;
  }
}
