import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { byCodePoint } from '@cf-loom/contract/internal';
import { generatedEnding } from '../config/index.ts';
import { filesUnder, oneLineOf, realPathOf, regionOf, sourceFolder } from '../loading/index.ts';
import {
  type HandlerPath,
  placementRefusalOf,
  type RecordedHandler,
  recordedHandlersOf,
  recordedLabelOf,
  refusalClauseOf,
} from '../service-code/index.ts';
import { isWrittenBy } from '../source-text/index.ts';
import type { PlacedService } from './handler-files.ts';
import { type Move, type PathLine, placementOf } from './placement.ts';

/**
 * The record `generate` wrote: the Handlers it moves, the lines for the Handlers only the author
 * can settle, the Handlers that lack a file, and the files it wrote at a path the layout no
 * longer names, which it deletes once their replacements are written; or the folder or file it
 * could not read.
 */
export type RecordRead =
  | {
      readonly kind: 'read';
      readonly moves: readonly Move[];
      readonly lines: readonly string[];
      readonly lacking: readonly HandlerPath[];
      readonly stale: readonly string[];
    }
  | { readonly kind: 'tooling'; readonly message: string };

/** A file `generate` wrote, with its text. */
type WrittenFile = { readonly path: string; readonly text: string };

/** The files `generate` wrote among some files, or the file that could not be read. */
type WrittenFiles =
  | { readonly kind: 'written'; readonly files: readonly WrittenFile[] }
  | { readonly kind: 'failed'; readonly message: string };

/**
 * Reads every file under `src/` that starts with the line `generate` writes first, and the
 * Handlers the Handler maps among them import, against the layout and the disk. After a layout
 * changes or a Group is renamed, the map would otherwise import a fresh Stub. A file of a folder
 * a link leads out of `src/` is never read, and an import of a path `generate` could not have
 * placed is a line, not a record.
 */
export function recordOf(service: PlacedService): RecordRead {
  const { directory } = service.project;
  const written = writtenFilesIn(directory);
  if (written.kind === 'failed') {
    return { kind: 'tooling', message: written.message };
  }
  const read = recordedIn(directory, written.files);
  const { moves, lines, lacking } = placementOf(service, read.accepted);
  const sorted = [...lines, ...read.refused].sort((left, right) =>
    byCodePoint(left.path, right.path),
  );
  return {
    kind: 'read',
    moves,
    lines: sorted.map(({ line }) => line),
    lacking,
    stale: staleOf(service, written.files),
  };
}

/** The files `generate` wrote under `src/`, outside what a link leads out of it and outside `src/contract/`. */
function writtenFilesIn(directory: string): WrittenFiles {
  const regionAt = regionOf(directory);
  const isOwned = (realPath: string) => regionAt(realPath) === 'owned';
  const found = filesUnder(directory, sourceFolder, {
    keeps: (path) => path.endsWith(generatedEnding) && isOwned(realPathOf(directory, path)),
    skips: (realFolder) => !isOwned(realFolder),
  });
  return found.kind === 'failed' ? found : writtenFilesOf(directory, found.files);
}

/** The Handlers some generated files record that `generate` could have placed, once each, and a line for each it could not. */
function recordedIn(
  directory: string,
  files: readonly WrittenFile[],
): { readonly accepted: readonly RecordedHandler[]; readonly refused: readonly PathLine[] } {
  const refusalOf = placementRefusalOf(directory);
  const accepted: RecordedHandler[] = [];
  const refused: PathLine[] = [];
  for (const handler of files.flatMap(({ path, text }) => recordedHandlersOf(path, text))) {
    const refusal = refusalOf(handler.kind, handler.path);
    if (refusal === undefined) {
      accepted.push(handler);
    } else {
      refused.push(refusedLineOf(handler, refusalClauseOf(refusal)));
    }
  }
  const byFile = new Map(
    accepted.map((handler) => [`${handler.local} ${realPathOf(directory, handler.path)}`, handler]),
  );
  return { accepted: [...byFile.values()], refused };
}

/** The line for an import of a path `generate` could not have placed, which only the author can settle. */
function refusedLineOf(handler: RecordedHandler, clause: string): PathLine {
  const { from, path } = handler;
  const records = `records the Handler of ${recordedLabelOf(handler)} at ${path}`;
  const fix = `fix the import, or delete ${from} if it is no Handler map`;
  return { path, line: `${from} ${records}, which ${clause}: ${fix}` };
}

/** The files among some files that start with the line `generate` writes first. */
function writtenFilesOf(directory: string, files: readonly string[]): WrittenFiles {
  const written: WrittenFile[] = [];
  for (const path of files) {
    try {
      const text = readFileSync(join(directory, path), 'utf8');
      if (isWrittenBy('generate', text)) {
        written.push({ path, text });
      }
    } catch (e) {
      return { kind: 'failed', message: `${path} cannot be read: ${oneLineOf(e, directory)}` };
    }
  }
  return { kind: 'written', files: written };
}

/**
 * The files `generate` wrote that the layout places neither the map nor the readers at, never the
 * one file the layout names reached through a link, since `generate` writes that one.
 */
function staleOf(service: PlacedService, files: readonly WrittenFile[]): readonly string[] {
  const { directory, layout } = service.project;
  const named = [layout.handlerMap, layout.readers].map((path) => realPathOf(directory, path));
  return files
    .map(({ path }) => path)
    .filter((path) => !named.includes(realPathOf(directory, path)))
    .sort(byCodePoint);
}
