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
import {
  elementLabelOf,
  type Handled,
  type HandlerPath,
  isWrittenByGenerate,
} from '../service-code/index.ts';
import { missingHandlersOf, type PlacedService } from './handler-files.ts';

/** The lines `generate` and `verify` print for orphan files, or the folder or file they cannot read. */
export type OrphanLines =
  | { readonly kind: 'lines'; readonly lines: readonly string[] }
  | { readonly kind: 'tooling'; readonly message: string };

type HandlerKind = Handled['kind'];

/** The kinds of Handler the layout places, in the order the documents list them. */
const handlerKinds: readonly HandlerKind[] = ['endpoint', 'guard', 'command', 'subscription'];

/** A file that sits where nothing declared or configured puts one, with the line saying so. */
type Orphan = { readonly path: string; readonly line: string };

/** The generated orphans among some files, or the file that could not be read. */
type GeneratedOrphans =
  | { readonly kind: 'orphans'; readonly orphans: readonly Orphan[] }
  | { readonly kind: 'failed'; readonly message: string };

/**
 * Every Handler file under `src/` outside `src/contract/` that fits a Handler template of the
 * layout and that nothing declared names, and every file `generate` wrote at a path the layout
 * does not name: after a layout changes or a Group is renamed, the map would import a fresh stub.
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
  const templates = handlerKinds.map((kind) => ({
    kind,
    pattern: templatePatternOf(layout[kind]),
  }));
  const named = new Set(service.handlerPaths.map(({ path }) => realPathOf(directory, path)));
  const missing = missingHandlersOf(service);
  const orphans: Orphan[] = [];
  for (const path of files.filter((file) => file.endsWith(handlerEnding))) {
    const kinds = templates.filter(({ pattern }) => pattern.test(path)).map(({ kind }) => kind);
    if (kinds.length > 0 && !named.has(realPathOf(directory, path))) {
      orphans.push({ path, line: `${path} ${ruleOf(kinds, missing)}` });
    }
  }
  return orphans;
}

/** What a line says of a Handler file that fits the templates of some kinds and names no Element. */
function ruleOf(kinds: readonly HandlerKind[], missing: readonly HandlerPath[]): string {
  const replacements = missing.filter(({ handled }) => kinds.includes(handled.kind));
  const named = orListOf(kinds.map(kindNameOf));
  return `names no declared ${named}: ${moveAdviceOf(replacements)}${lastResortOf(kinds)}`;
}

function kindNameOf(kind: HandlerKind): string {
  switch (kind) {
    case 'endpoint':
      return 'Endpoint';
    case 'guard':
      return 'Guard';
    case 'command':
      return "Command's Message Version";
    case 'subscription':
      return 'Subscription';
  }
}

/** Where a Handler file may move to: the Handlers of its kinds that lack a file, or nothing to say. */
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

/** What is left to do with a Handler file that moves nowhere: a Guard is declared in no Group. */
function lastResortOf(kinds: readonly HandlerKind[]): string {
  const isListedByGroup = kinds.some((kind) => kind !== 'guard');
  return isListedByGroup ? 'list its declaration in a Group or delete it' : 'delete it';
}

/** Items as a sentence names alternatives: `a`, `a or b`, `a, b or c`. */
function orListOf(items: readonly string[]): string {
  const last = items.at(-1) ?? '';
  return items.length < 2 ? last : `${items.slice(0, -1).join(', ')} or ${last}`;
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
