import { type Broken, pathNotPlainAscii, pathNotWritten } from './tar-broken.ts';

const maxSegmentsAfterFirst = 1024;
const printableAscii = /^[\x20-\x7e]*$/;
const driveOrSeparator = /[:\\]/;

/** Where npm unpacks an entry, with its first folder stripped and empty and `.` segments dropped. */
export type Unpacked = { readonly kind: 'unpacked'; readonly path: string };

/**
 * The path an entry unpacks to, or the refusal of one with a character other than printable ASCII,
 * a `:` or a `\`, and of one npm does not write or its tar leaves out.
 */
export function unpackedPathOf(path: string, holds: 'file' | 'folder'): Unpacked | Broken {
  if (!printableAscii.test(path) || driveOrSeparator.test(path)) {
    return pathNotPlainAscii;
  }
  const segments = path.split('/');
  const endsLikeFolder = holds === 'file' && path.endsWith('/');
  const isTooDeep = segments.length > maxSegmentsAfterFirst + 1;
  if (path === '' || segments.includes('..') || endsLikeFolder || isTooDeep) {
    return pathNotWritten;
  }
  const inside = segments.slice(1).filter((segment) => segment !== '' && segment !== '.');
  return { kind: 'unpacked', path: inside.join('/') };
}

/** A path as a filesystem that ignores case, whether by simple or full folding, sees it. */
export function foldedCase(path: string): string {
  return path.toUpperCase().toLowerCase();
}
