import { readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { byCodePoint } from '@cf-loom/contract/internal';
import {
  generatedEnding,
  handlerEnding,
  layoutFolder,
  templatePatternOf,
} from '../config/index.ts';
import { filesUnder, insideContractOf, oneLineOf } from '../loading/index.ts';
import { isWrittenByGenerate } from '../service-code/index.ts';
import type { PlacedService } from './handler-files.ts';

/** The lines `generate` and `verify` print for orphan files, or the folder or file they cannot read. */
export type OrphanLines =
  | { readonly kind: 'lines'; readonly lines: readonly string[] }
  | { readonly kind: 'tooling'; readonly message: string };

/** The fields of the layout that place a kind of Handler. */
const handlerFields = ['endpoint', 'guard', 'command', 'subscription'] as const;

/** A file that sits where nothing declared or configured puts one, with the line saying so. */
type Orphan = { readonly path: string; readonly line: string };

/** The generated orphans among some files, or the file that could not be read. */
type GeneratedOrphans =
  | { readonly kind: 'orphans'; readonly orphans: readonly Orphan[] }
  | { readonly kind: 'failed'; readonly message: string };

/**
 * Every Handler file under `src/` outside `src/contract/` that nothing declared names, and every
 * file `generate` wrote at a path the layout does not name: after a layout changes or a Group is
 * renamed, the map would import a fresh stub.
 */
export function orphanLinesOf(service: PlacedService): OrphanLines {
  const { directory } = service.project;
  const found = filesUnder(directory, layoutFolder, {
    keeps: (path) => path.endsWith(handlerEnding) || path.endsWith(generatedEnding),
    skips: insideContractOf(directory),
  });
  if (found.kind === 'failed') {
    return { kind: 'tooling', message: found.message };
  }
  const generated = generatedOrphansOf(service, found.files);
  if (generated.kind === 'failed') {
    return { kind: 'tooling', message: generated.message };
  }
  const orphans = [...handlerOrphansOf(service, found.files), ...generated.orphans];
  const sorted = orphans.sort((left, right) => byCodePoint(left.path, right.path));
  return { kind: 'lines', lines: sorted.map(({ line }) => line) };
}

/**
 * The Handler files among some files that fit a Handler template of the layout and that no
 * declared Element names, a Retired Endpoint or Command's Message Version still declared counting
 * as naming its Handler; a file names an Element when both have one real path.
 */
function handlerOrphansOf(service: PlacedService, files: readonly string[]): readonly Orphan[] {
  const { directory, layout } = service.project;
  const patterns = handlerFields.map((field) => templatePatternOf(layout[field]));
  const named = new Set(service.handlerPaths.map(({ path }) => realPathOf(directory, path)));
  const rule = "names no declared Endpoint, Guard, Command's Message Version or Subscription";
  return files
    .filter((path) => path.endsWith(handlerEnding))
    .filter((path) => patterns.some((pattern) => pattern.test(path)))
    .filter((path) => !named.has(realPathOf(directory, path)))
    .map((path) => ({ path, line: `${path} ${rule}: delete it` }));
}

/** A path's real path, links followed, or the path itself where nothing resolves. */
function realPathOf(directory: string, path: string): string {
  const absolute = join(directory, path);
  try {
    return realpathSync(absolute);
  } catch {
    return absolute;
  }
}

/** The files among some files that `generate` wrote and the layout places neither the map nor the readers at. */
function generatedOrphansOf(service: PlacedService, files: readonly string[]): GeneratedOrphans {
  const { directory, layout } = service.project;
  const rule = 'is a file cf-loom generate wrote, at no path the layout names';
  const unnamed = files.filter(
    (path) =>
      path.endsWith(generatedEnding) && path !== layout.handlerMap && path !== layout.readers,
  );
  const orphans: Orphan[] = [];
  for (const path of unnamed) {
    try {
      if (isWrittenByGenerate(readFileSync(join(directory, path), 'utf8'))) {
        orphans.push({ path, line: `${path} ${rule}: delete it` });
      }
    } catch (e) {
      return { kind: 'failed', message: `${path} cannot be read: ${oneLineOf(e, directory)}` };
    }
  }
  return { kind: 'orphans', orphans };
}
