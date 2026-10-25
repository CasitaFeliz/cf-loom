import { lstatSync, readlinkSync, realpathSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

/** How many links in a row are followed before one is taken for a loop. */
const maxLinkHops = 40;

/**
 * What a project path is as a file: its real path with every link followed as far as the path
 * exists, a link to something that does not exist yet included, so two spellings of one file, or
 * of one place a file will be, are one identity.
 */
export function realPathOf(directory: string, path: string): string {
  return resolvedOf(join(directory, path), [], 0);
}

function resolvedOf(absolute: string, rest: readonly string[], hops: number): string {
  try {
    return join(realpathSync(absolute), ...rest);
  } catch {
    const target = danglingTargetOf(absolute);
    if (target !== undefined && hops < maxLinkHops) {
      return resolvedOf(target, rest, hops + 1);
    }
    const parent = dirname(absolute);
    if (parent === absolute) {
      return join(absolute, ...rest);
    }
    return resolvedOf(parent, [basename(absolute), ...rest], hops);
  }
}

/** Where a link that reaches nothing points, as the system reads it: from the folder the link is in. */
function danglingTargetOf(absolute: string): string | undefined {
  try {
    if (!lstatSync(absolute).isSymbolicLink()) {
      return undefined;
    }
    return resolve(realpathSync(dirname(absolute)), readlinkSync(absolute));
  } catch {
    return undefined;
  }
}
