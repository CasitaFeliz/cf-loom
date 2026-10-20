import { lstatSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { byCodePoint } from '@cf-loom/contract/internal';
import { filesUnder } from '../loading/index.ts';
import type { BuiltService } from '../project/index.ts';
import {
  handledOf,
  handlerFolders,
  handlerPathOf,
  namedHandlerPathsOf,
} from '../service-code/index.ts';

/** The Handler files the Handler map imports. */
export function handlerPathsOf({ snapshot }: Pick<BuiltService, 'snapshot'>): readonly string[] {
  return handledOf(snapshot).map(handlerPathOf);
}

/** The Handler paths the Handler map imports where nothing is, not even a link. */
export function missingHandlerPathsOf(
  service: Pick<BuiltService, 'snapshot' | 'project'>,
): readonly string[] {
  const { directory } = service.project;
  return handlerPathsOf(service).filter((path) => isNothingAt(join(directory, path)));
}

/** A line for every Handler path that something other than a file holds. */
export function noFileLinesOf(
  service: Pick<BuiltService, 'snapshot' | 'project'>,
): readonly string[] {
  const { directory } = service.project;
  const blocked = handlerPathsOf(service).filter((path) => isNoFile(join(directory, path)));
  return blocked.map((path) => `${path} is no file: a Handler is a file`);
}

/** Nothing is at the path, not even a dangling link, so a stub may be written there. */
export function isNothingAt(path: string): boolean {
  try {
    lstatSync(path);
    return false;
  } catch {
    return true;
  }
}

/** Something is at the path, a dangling link included, and it is no file once links are followed. */
function isNoFile(path: string): boolean {
  if (isNothingAt(path)) {
    return false;
  }
  try {
    return !statSync(path).isFile();
  } catch {
    return true;
  }
}

/** The lines `generate` and `verify` print for orphan Handler files, or the folder they cannot read. */
export type OrphanLines =
  | { readonly kind: 'lines'; readonly lines: readonly string[] }
  | { readonly kind: 'tooling'; readonly message: string };

/**
 * Every Handler file under the Handlers' folders, through linked folders too, that nothing
 * declared names, a Retired Endpoint still declared counting as naming its Handler: after a
 * rename, the map would import a fresh stub.
 */
export function orphanLinesOf({
  snapshot,
  project,
}: Pick<BuiltService, 'snapshot' | 'project'>): OrphanLines {
  const named = namedHandlerPathsOf(snapshot);
  const present: string[] = [];
  for (const folder of handlerFolders) {
    const found = filesUnder(project.directory, folder, (path) => path.endsWith('.handler.ts'));
    if (found.kind === 'failed') {
      return { kind: 'tooling', message: found.message };
    }
    present.push(...found.files);
  }
  const orphans = present.filter((path) => !named.has(path)).sort(byCodePoint);
  const lines = orphans.map((path) => `${path} ${orphanRule}: delete it`);
  return { kind: 'lines', lines };
}

/** What an orphan Handler file is, as its line says it. */
const orphanRule = "names no declared Endpoint, Guard, Command's Message Version or Subscription";
