import { existsSync, globSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { byCodePoint } from '@casitafeliz/loom-contract/internal';
import {
  handledOf,
  handlerFolders,
  handlerPathOf,
  namedHandlerPathsOf,
} from '../service-code/index.ts';
import type { BuiltService } from './built.ts';

/** The Handler files the Handler map imports. */
export function handlerPathsOf(service: BuiltService): readonly string[] {
  return handledOf(service.snapshot).map(handlerPathOf);
}

/** A line for every Handler path that something other than a file holds. */
export function noFileLinesOf(service: BuiltService): readonly string[] {
  const { directory } = service.project;
  const blocked = handlerPathsOf(service).filter((path) => isNoFile(join(directory, path)));
  return blocked.map((path) => `${path} is no file: a Handler is a file`);
}

function isNoFile(path: string): boolean {
  return existsSync(path) && !statSync(path).isFile();
}

/**
 * Every Handler file under the Handlers' folders that no declared Endpoint or Guard names, a
 * Retired one still declared included: after a rename, the map would import a fresh stub.
 */
export function orphanLinesOf(service: BuiltService): readonly string[] {
  const named = namedHandlerPathsOf(service.snapshot);
  const present = handlerFolders.flatMap((folder) =>
    globSync(`${folder}**/*.handler.ts`, { cwd: service.project.directory }),
  );
  const orphans = present
    .map((path) => path.split('\\').join('/'))
    .filter((path) => !named.has(path));
  return orphans
    .sort(byCodePoint)
    .map((path) => `${path} names no declared Endpoint or Guard: delete it`);
}
