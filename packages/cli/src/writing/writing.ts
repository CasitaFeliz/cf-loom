import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
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

/**
 * A file a command generates, relative to the project: one regenerated `always`, or a Stub
 * written `once`, never over a Handler that exists.
 */
export type GeneratedFile = {
  readonly path: string;
  readonly text: string | Uint8Array;
  readonly written: 'always' | 'once';
};

/** The files written, by path, or the file a write stopped at, in one line, with the files written before it. */
export type Written =
  | { readonly kind: 'written'; readonly paths: readonly string[] }
  | { readonly kind: 'failed'; readonly message: string; readonly paths: readonly string[] };

/** What became of one file: written, kept since its Handler exists, or why it failed. */
type FileWrite =
  | { readonly kind: 'written' }
  | { readonly kind: 'kept' }
  | { readonly kind: 'failed'; readonly reason: string };

/**
 * Writes each file in order: a regenerated one beside its target under a name of this run's,
 * renamed over it, so a failed or concurrent write leaves a whole file; a Stub only where no
 * Handler exists. A rerun completes what a failure left undone.
 */
export function writeFiles(directory: string, files: readonly GeneratedFile[]): Written {
  const paths: string[] = [];
  for (const file of files) {
    const written = writeFile(directory, file);
    if (written.kind === 'failed') {
      const message = `${file.path} cannot be written: ${written.reason}`;
      return { kind: 'failed', message, paths };
    }
    if (written.kind === 'written') {
      paths.push(file.path);
    }
  }
  return { kind: 'written', paths };
}

function writeFile(directory: string, file: GeneratedFile): FileWrite {
  const path = join(directory, file.path);
  const temporary = `${path}.${randomUUID()}.tmp`;
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

/** A Stub, written only where nothing is, so a Handler another run just wrote is kept too. */
function writeOnce(path: string, file: GeneratedFile): FileWrite {
  try {
    writeFileSync(path, file.text, { flag: 'wx' });
    return { kind: 'written' };
  } catch (e) {
    if (e instanceof Error && 'code' in e && e.code === 'EEXIST') {
      return { kind: 'kept' };
    }
    throw e;
  }
}

/** How the bytes of a file on disk differ from those expected: not at all, only by CRLF line endings, or otherwise. */
export type FileComparison = 'same' | 'crlf' | 'different';

/** Compares a file on disk with the bytes expected; a CRLF checkout of the expected text is told apart, never accepted. */
export function fileComparisonOf(expected: Uint8Array, onDisk: Uint8Array): FileComparison {
  const wanted = Buffer.from(expected);
  const found = Buffer.from(onDisk);
  if (wanted.equals(found)) {
    return 'same';
  }
  const withLf = Buffer.from(found.toString('latin1').replaceAll('\r\n', '\n'), 'latin1');
  return wanted.equals(withLf) ? 'crlf' : 'different';
}

/** A generated file on disk compared with what would be generated, or why it cannot be read. */
export type Compared =
  | { readonly kind: FileComparison }
  | { readonly kind: 'failed'; readonly message: string };

/** Whether a generated file on disk holds exactly what would be generated, in one line if unreadable. */
export function comparedOf(directory: string, file: GeneratedFile): Compared {
  const path = join(directory, file.path);
  try {
    if (!existsSync(path) || !statSync(path).isFile()) {
      return { kind: 'different' };
    }
    return { kind: fileComparisonOf(Buffer.from(file.text), readFileSync(path)) };
  } catch (e) {
    return { kind: 'failed', message: `${file.path} cannot be read: ${oneLineOf(e, directory)}` };
  }
}

/** Removes a file the write left; what is no file there is not the write's and stays. */
function removeFile(path: string): void {
  if (existsSync(path) && statSync(path).isFile()) {
    rmSync(path);
  }
}
