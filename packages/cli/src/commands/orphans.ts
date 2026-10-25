import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { byCodePoint, oneOf } from '@cf-loom/contract/internal';
import { generatedEnding, layoutFolder } from '../config/index.ts';
import { filesUnder, insideContractOf, oneLineOf } from '../loading/index.ts';
import {
  elementLabelOf,
  type Handled,
  type HandlerPath,
  handlerLocalOf,
  isWrittenByGenerate,
  type RecordedHandler,
  recordedHandlersOf,
  recordedLabelOf,
  retiredHandledOf,
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

/** What the recorded Handlers are read against: where each Element's Handler is now, and which are Retired. */
type Placement = {
  readonly directory: string;
  readonly declared: ReadonlyMap<string, HandlerPath>;
  readonly retired: ReadonlyMap<string, Handled>;
  readonly lacking: readonly HandlerPath[];
};

/**
 * The Handlers the Handler maps among some files import whose file still sits at the path they
 * were imported from, though the layout now places the Element elsewhere or it is Retired or
 * gone: the map would stop importing a file that is still there.
 */
function handlerOrphansOf(
  service: PlacedService,
  files: readonly WrittenFile[],
): readonly Orphan[] {
  const { directory } = service.project;
  const recorded = files.flatMap(({ path, text }) => recordedHandlersOf(path, text));
  const standing = recorded.filter(({ path }) => !isNothingAt(join(directory, path)));
  const held = new Set(standing.map(({ local }) => local));
  const placement: Placement = {
    directory,
    declared: new Map(
      service.handlerPaths.map((placed) => [handlerLocalOf(placed.handled), placed]),
    ),
    retired: new Map(
      retiredHandledOf(service.snapshot).map((handled) => [handlerLocalOf(handled), handled]),
    ),
    lacking: missingHandlersOf(service).filter(({ handled }) => !held.has(handlerLocalOf(handled))),
  };
  const orphans: Orphan[] = [];
  for (const handler of standing) {
    const line = lineOf(handler, placement);
    if (line !== undefined) {
      orphans.push({ path: handler.path, line });
    }
  }
  return orphans;
}

/** The line for a recorded Handler whose file is still there, or none while the map keeps importing it from there. */
function lineOf(handler: RecordedHandler, placement: Placement): string | undefined {
  const placed = placement.declared.get(handler.local);
  if (placed?.path === handler.path) {
    return undefined;
  }
  if (placed !== undefined) {
    return movedLineOf(placement.directory, handler, placed);
  }
  const retired = placement.retired.get(handler.local);
  if (retired !== undefined) {
    return `${handler.path} is the Handler of ${elementLabelOf(retired)}, which is Retired: delete it`;
  }
  return goneLineOf(handler, placement.lacking);
}

/** The line for a Handler whose Element the layout now places at another path. */
function movedLineOf(directory: string, handler: RecordedHandler, placed: HandlerPath): string {
  const action = isNothingAt(join(directory, placed.path)) ? 'move it' : 'delete it';
  const now = `is the Handler of ${elementLabelOf(placed.handled)}, which is now ${placed.path}`;
  return `${handler.path} ${now}: ${action}`;
}

/** The line for a Handler whose Element is no longer declared, naming the Elements that may replace it. */
function goneLineOf(handler: RecordedHandler, lacking: readonly HandlerPath[]): string {
  const replacements = lacking.filter(({ handled }) => handled.kind === handler.kind);
  const gone = `is the Handler of ${recordedLabelOf(handler)}, which is no longer declared`;
  return `${handler.path} ${gone}: ${adviceOf(replacements)}`;
}

/** What to do with a Handler whose Element is gone: move it to the Handler path that lacks a file, else delete it. */
function adviceOf(replacements: readonly HandlerPath[]): string {
  const [only, ...others] = replacements;
  if (only === undefined) {
    return 'delete it';
  }
  if (others.length === 0) {
    return `move it to ${only.path} if ${elementLabelOf(only.handled)} replaces it, else delete it`;
  }
  const candidates = replacements.map(
    ({ handled, path }) => `${elementLabelOf(handled)} (${path})`,
  );
  return `move it to the Handler path of the Element that replaces it, ${oneOf(candidates)}, else delete it`;
}
