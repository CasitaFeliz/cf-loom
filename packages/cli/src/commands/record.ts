import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { byCodePoint } from '@cf-loom/contract/internal';
import { generatedEnding, layoutFolder } from '../config/index.ts';
import { filesUnder, insideContractOf, oneLineOf, realPathOf } from '../loading/index.ts';
import {
  type HandlerPath,
  isWrittenByGenerate,
  recordedHandlersOf,
} from '../service-code/index.ts';
import type { PlacedService } from './handler-files.ts';
import { type Move, placementOf } from './placement.ts';

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
 * changes or a Group is renamed, the map would otherwise import a fresh stub.
 */
export function recordOf(service: PlacedService): RecordRead {
  const { directory } = service.project;
  const found = filesUnder(directory, layoutFolder, {
    keeps: (path) => path.endsWith(generatedEnding),
    skips: insideContractOf(directory),
  });
  if (found.kind === 'failed') {
    return { kind: 'tooling', message: found.message };
  }
  const written = writtenFilesOf(directory, found.files);
  if (written.kind === 'failed') {
    return { kind: 'tooling', message: written.message };
  }
  const read = written.files.flatMap(({ path, text }) => recordedHandlersOf(path, text));
  const recorded = [
    ...new Map(read.map((handler) => [`${handler.local} ${handler.path}`, handler])).values(),
  ];
  const { moves, lines, lacking } = placementOf(service, recorded);
  const sorted = [...lines].sort((left, right) => byCodePoint(left.path, right.path));
  return {
    kind: 'read',
    moves,
    lines: sorted.map(({ line }) => line),
    lacking,
    stale: staleOf(service, written.files),
  };
}

/** The files among some files that start with the line `generate` writes first. */
function writtenFilesOf(directory: string, files: readonly string[]): WrittenFiles {
  const written: WrittenFile[] = [];
  for (const path of files) {
    try {
      const text = readFileSync(join(directory, path), 'utf8');
      if (isWrittenByGenerate(text)) {
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
