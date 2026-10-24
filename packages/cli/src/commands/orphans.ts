import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { byCodePoint } from '@cf-loom/contract/internal';
import { generatedEnding, handlerEnding } from '../config/index.ts';
import { contractFolder, filesUnder, oneLineOf } from '../loading/index.ts';
import { headerOf } from '../source-text/index.ts';
import type { PlacedService } from './handler-files.ts';

/** The lines `generate` and `verify` print for orphan files, or the folder or file they cannot read. */
export type OrphanLines =
  | { readonly kind: 'lines'; readonly lines: readonly string[] }
  | { readonly kind: 'tooling'; readonly message: string };

/** A file that sits where nothing declared or configured puts one, with the line saying so. */
type Orphan = { readonly path: string; readonly line: string };

/**
 * Every Handler file under `src/` outside `src/contract/`, through linked folders too, that
 * nothing declared names, a Retired Endpoint or Command's Message Version still declared counting
 * as naming its Handler, and every file `generate` wrote at a path the layout does not name: after
 * a layout changes or a Group is renamed, the map would import a fresh stub.
 */
export function orphanLinesOf(service: PlacedService): OrphanLines {
  const { directory, layout } = service.project;
  const found = filesUnder(directory, 'src', {
    keeps: (path) => isHandlerFile(path) || isGeneratedFile(path),
    skips: (path) => path === contractFolder,
  });
  if (found.kind === 'failed') {
    return { kind: 'tooling', message: found.message };
  }
  const handlerPaths = new Set(service.handlerPaths.map(({ path }) => path));
  const handlers = found.files.filter(isHandlerFile).filter((path) => !handlerPaths.has(path));
  const generatedPaths = new Set([layout.handlerMap, layout.readers]);
  const unnamed = found.files.filter(isGeneratedFile).filter((path) => !generatedPaths.has(path));
  const generated = generatedAmong(directory, unnamed);
  if (generated.kind === 'failed') {
    return { kind: 'tooling', message: generated.message };
  }
  const orphans = [...handlers.map(handlerOrphanOf), ...generated.paths.map(generatedOrphanOf)];
  const sorted = orphans.sort((left, right) => byCodePoint(left.path, right.path));
  return { kind: 'lines', lines: sorted.map(({ line }) => line) };
}

function handlerOrphanOf(path: string): Orphan {
  const rule = "names no declared Endpoint, Guard, Command's Message Version or Subscription";
  return { path, line: `${path} ${rule}: delete it` };
}

function generatedOrphanOf(path: string): Orphan {
  return {
    path,
    line: `${path} is a file cf-loom generate wrote, at no path the layout names: delete it`,
  };
}

/** The paths of files that start with the line `generate` writes first, or the file unread. */
function generatedAmong(
  directory: string,
  paths: readonly string[],
):
  | { readonly kind: 'generated'; readonly paths: readonly string[] }
  | { readonly kind: 'failed'; readonly message: string } {
  const generated: string[] = [];
  for (const path of paths) {
    try {
      const first = readFileSync(join(directory, path), 'utf8').split('\n', 1)[0];
      if (first === headerOf('generate')) {
        generated.push(path);
      }
    } catch (e) {
      return { kind: 'failed', message: `${path} cannot be read: ${oneLineOf(e, directory)}` };
    }
  }
  return { kind: 'generated', paths: generated };
}

function isHandlerFile(path: string): boolean {
  return path.endsWith(handlerEnding);
}

function isGeneratedFile(path: string): boolean {
  return path.endsWith(generatedEnding);
}
