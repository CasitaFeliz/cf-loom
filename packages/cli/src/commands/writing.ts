import { Buffer } from 'node:buffer';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { oneLineOf } from '../loading/index.ts';
import { type Exit, toolingError } from './exit.ts';

/**
 * A file a command generates, relative to the project: one regenerated `always`, or a stub
 * written `once`, never over a Handler that exists.
 */
export type GeneratedFile = {
  readonly path: string;
  readonly text: string | Uint8Array;
  readonly written: 'always' | 'once';
};

/** The files written, by path, or the tooling error that stopped at one of them. */
export type Written =
  | { readonly kind: 'written'; readonly paths: readonly string[] }
  | { readonly kind: 'stopped'; readonly exit: Exit };

/** What became of one file: written, kept since its Handler exists, or why it failed. */
type FileWrite =
  | { readonly kind: 'written' }
  | { readonly kind: 'kept' }
  | { readonly kind: 'failed'; readonly reason: string };

/**
 * Writes each file in order: a regenerated one beside its target, renamed over it, so a failed
 * write leaves the file as it was; a stub only where no Handler exists. A rerun completes what a
 * failure left undone.
 */
export function writeFiles(directory: string, files: readonly GeneratedFile[]): Written {
  const paths: string[] = [];
  for (const file of files) {
    const written = writeFile(directory, file);
    if (written.kind === 'failed') {
      const exit = toolingError(`${file.path} cannot be written: ${written.reason}`);
      return { kind: 'stopped', exit };
    }
    if (written.kind === 'written') {
      paths.push(file.path);
    }
  }
  return { kind: 'written', paths };
}

function writeFile(directory: string, file: GeneratedFile): FileWrite {
  const path = join(directory, file.path);
  const temporary = `${path}.tmp`;
  try {
    mkdirSync(dirname(path), { recursive: true });
    if (file.written === 'once') {
      return writeOnce(path, file);
    }
    writeFileSync(temporary, file.text);
    renameSync(temporary, path);
    return { kind: 'written' };
  } catch (e) {
    removeFile(temporary);
    return { kind: 'failed', reason: oneLineOf(e, directory) };
  }
}

function writeOnce(path: string, file: GeneratedFile): FileWrite {
  if (existsSync(path)) {
    return { kind: 'kept' };
  }
  writeFileSync(path, file.text, { flag: 'wx' });
  return { kind: 'written' };
}

/** Whether a generated file on disk holds exactly what would be generated. */
export function isUpToDate(directory: string, file: GeneratedFile): boolean {
  const path = join(directory, file.path);
  if (!existsSync(path) || !statSync(path).isFile()) {
    return false;
  }
  return Buffer.from(file.text).equals(readFileSync(path));
}

/** Removes a file the write left; what is no file there is not the write's and stays. */
function removeFile(path: string): void {
  if (existsSync(path) && statSync(path).isFile()) {
    rmSync(path);
  }
}
