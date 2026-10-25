import { realpathSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

/**
 * What a project path is as a file: its real path with every link followed as far as the path
 * exists, so two spellings of one file, or of one place a file will be, are one identity.
 */
export function realPathOf(directory: string, path: string): string {
  return resolvedOf(join(directory, path), []);
}

function resolvedOf(absolute: string, rest: readonly string[]): string {
  try {
    return join(realpathSync(absolute), ...rest);
  } catch {
    const parent = dirname(absolute);
    if (parent === absolute) {
      return join(absolute, ...rest);
    }
    return resolvedOf(parent, [basename(absolute), ...rest]);
  }
}
