import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { byCodePoint } from '@cf-loom/contract/internal';
import { generatedEnding, layoutFolder } from '../config/index.ts';
import { filesUnder, insideContractOf, oneLineOf } from '../loading/index.ts';
import {
  type HandlerPath,
  isWrittenByGenerate,
  recordedHandlersOf,
} from '../service-code/index.ts';
import type { PlacedService } from './handler-files.ts';
import { type Move, type PathLine, placementOf } from './placement.ts';

/**
 * What the files `generate` wrote come to: the lines for those at a path the layout does not
 * name and for the Handlers only the author can settle, the Handlers `generate` moves, and the
 * Handlers that lack a file; or the folder or file it could not read.
 */
export type Orphans =
  | {
      readonly kind: 'read';
      readonly lines: readonly string[];
      readonly moves: readonly Move[];
      readonly lacking: readonly HandlerPath[];
    }
  | { readonly kind: 'tooling'; readonly message: string };

/** A file `generate` wrote, with its text. */
type WrittenFile = { readonly path: string; readonly text: string };

/** The files `generate` wrote among some files, or the file that could not be read. */
type WrittenFiles =
  | { readonly kind: 'written'; readonly files: readonly WrittenFile[] }
  | { readonly kind: 'failed'; readonly message: string };

/**
 * Every file `generate` wrote at a path the layout does not name, and every Handler the Handler
 * map imports that the layout now places elsewhere, to move, or whose Element is Retired or
 * gone, to settle: after a layout changes or a Group is renamed, the map would import a fresh stub.
 */
export function orphansOf(service: PlacedService): Orphans {
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
  const recorded = written.files.flatMap(({ path, text }) => recordedHandlersOf(path, text));
  const { moves, lines, lacking } = placementOf(service, recorded);
  const sorted = [...generatedOrphansOf(service, written.files), ...lines].sort((left, right) =>
    byCodePoint(left.path, right.path),
  );
  return { kind: 'read', lines: sorted.map(({ line }) => line), moves, lacking };
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

/** The files `generate` wrote that the layout places neither the map nor the readers at. */
function generatedOrphansOf(
  service: PlacedService,
  files: readonly WrittenFile[],
): readonly PathLine[] {
  const { layout } = service.project;
  const rule = 'is a file cf-loom generate wrote, at no path the layout names';
  return files
    .filter(({ path }) => path !== layout.handlerMap && path !== layout.readers)
    .map(({ path }) => ({ path, line: `${path} ${rule}: delete it` }));
}
