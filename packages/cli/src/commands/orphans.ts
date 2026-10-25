import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { byCodePoint } from '@cf-loom/contract/internal';
import { generatedEnding, layoutFolder } from '../config/index.ts';
import { filesUnder, insideContractOf, oneLineOf } from '../loading/index.ts';
import {
  elementLabelOf,
  type HandlerPath,
  handlerLocalOf,
  isWrittenByGenerate,
  type RecordedHandler,
  recordedHandlersOf,
  recordedLabelOf,
} from '../service-code/index.ts';
import { isNothingAt, missingHandlersOf, type PlacedService } from './handler-files.ts';

/** The lines `generate` and `verify` print for orphan files, or the folder or file they cannot read. */
export type OrphanLines =
  | { readonly kind: 'lines'; readonly lines: readonly string[] }
  | { readonly kind: 'tooling'; readonly message: string };

/** A file that sits where nothing declared or configured puts one, with the line saying so. */
type Orphan = { readonly path: string; readonly line: string };

/** A file `generate` wrote, with its text. */
type WrittenFile = { readonly path: string; readonly text: string };

/** The files `generate` wrote among some files, or the file that could not be read. */
type WrittenFiles =
  | { readonly kind: 'written'; readonly files: readonly WrittenFile[] }
  | { readonly kind: 'failed'; readonly message: string };

/**
 * Every file `generate` wrote at a path the layout does not name, and every Handler the Handler
 * map imports that the layout now places elsewhere or whose Element is gone: after a layout
 * changes or a Group is renamed, the map would import a fresh stub.
 */
export function orphanLinesOf(service: PlacedService): OrphanLines {
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
  const generated = generatedOrphansOf(service, written.files);
  const orphans = [...generated, ...handlerOrphansOf(service, written.files)];
  const sorted = orphans.sort((left, right) => byCodePoint(left.path, right.path));
  return { kind: 'lines', lines: sorted.map(({ line }) => line) };
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
): readonly Orphan[] {
  const { layout } = service.project;
  const rule = 'is a file cf-loom generate wrote, at no path the layout names';
  return files
    .filter(({ path }) => path !== layout.handlerMap && path !== layout.readers)
    .map(({ path }) => ({ path, line: `${path} ${rule}: delete it` }));
}

/**
 * The Handlers the Handler maps among some files import whose file still sits at the path they
 * were imported from, though the layout now places the Element elsewhere or it is gone. A
 * Retired Endpoint or Command's Message Version still declared keeps its Handler where it is.
 */
function handlerOrphansOf(
  service: PlacedService,
  files: readonly WrittenFile[],
): readonly Orphan[] {
  const { directory } = service.project;
  const recorded = files.flatMap(({ path, text }) => recordedHandlersOf(path, text));
  const declared = new Map(
    service.handlerPaths.map((placed) => [handlerLocalOf(placed.handled), placed]),
  );
  const missing = missingHandlersOf(service);
  const orphans: Orphan[] = [];
  for (const handler of recorded) {
    const placed = declared.get(handler.local);
    if (isNothingAt(join(directory, handler.path)) || placed?.path === handler.path) {
      continue;
    }
    const line =
      placed === undefined
        ? goneLineOf(handler, missing)
        : movedLineOf(handler, placed, isNothingAt(join(directory, placed.path)));
    orphans.push({ path: handler.path, line });
  }
  return orphans;
}

/** The line for a Handler whose Element the layout now places at another path. */
function movedLineOf(handler: RecordedHandler, placed: HandlerPath, isFree: boolean): string {
  const action = isFree ? 'move it' : 'delete it';
  const now = `is the Handler of ${elementLabelOf(placed.handled)}, which is now ${placed.path}`;
  return `${handler.path} ${now}: ${action}`;
}

/** The line for a Handler whose Element is no longer declared, naming the Elements that may replace it. */
function goneLineOf(handler: RecordedHandler, missing: readonly HandlerPath[]): string {
  const replacements = missing.filter(({ handled }) => handled.kind === handler.kind);
  const gone = `is the Handler of ${recordedLabelOf(handler)}, which is no longer declared`;
  return `${handler.path} ${gone}: ${moveAdviceOf(replacements)}delete it`;
}

/** Where a Handler file may move to: the Handlers of its kind that lack a file, or nothing to say. */
function moveAdviceOf(replacements: readonly HandlerPath[]): string {
  const [only, ...others] = replacements;
  if (only === undefined) {
    return '';
  }
  if (others.length === 0) {
    return `move it to ${only.path} if ${elementLabelOf(only.handled)} replaces it, else `;
  }
  const candidates = replacements.map(
    ({ handled, path }) => `${elementLabelOf(handled)} (${path})`,
  );
  return `move it to the Handler path of the Element that replaces it, ${orListOf(candidates)}, else `;
}

/** Alternatives as a sentence names them: `a or b`, `a, b or c`. */
function orListOf(items: readonly string[]): string {
  const last = items.at(-1) ?? '';
  return `${items.slice(0, -1).join(', ')} or ${last}`;
}
