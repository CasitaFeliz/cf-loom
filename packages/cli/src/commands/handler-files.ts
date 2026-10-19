import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { byCodePoint } from '@casitafeliz/loom-contract/internal';
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

/** A line for every Handler path that something other than a file holds. */
export function noFileLinesOf(
  service: Pick<BuiltService, 'snapshot' | 'project'>,
): readonly string[] {
  const { directory } = service.project;
  const blocked = handlerPathsOf(service).filter((path) => isNoFile(join(directory, path)));
  return blocked.map((path) => `${path} is no file: a Handler is a file`);
}

function isNoFile(path: string): boolean {
  return existsSync(path) && !statSync(path).isFile();
}

/**
 * Every Handler file under the Handlers' folders, through linked folders too, that no declared
 * Endpoint or Guard names, a Retired one still declared included: after a rename, the map would
 * import a fresh stub.
 */
export function orphanLinesOf({
  snapshot,
  project,
}: Pick<BuiltService, 'snapshot' | 'project'>): readonly string[] {
  const named = namedHandlerPathsOf(snapshot);
  const present = handlerFolders.flatMap((folder) =>
    filesUnder(project.directory, folder, (path) => path.endsWith('.handler.ts')),
  );
  const orphans = present.filter((path) => !named.has(path));
  return orphans
    .sort(byCodePoint)
    .map((path) => `${path} names no declared Endpoint or Guard: delete it`);
}
