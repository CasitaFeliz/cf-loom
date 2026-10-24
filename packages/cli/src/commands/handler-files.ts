import { lstatSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { BuiltService, Tooling } from '../project/index.ts';
import { type HandlerPath, handlerPathsOf } from '../service-code/index.ts';

/** A Service with the Handler path of every Element it declares one for. */
export type PlacedService = BuiltService & { readonly handlerPaths: readonly HandlerPath[] };

/** The Service with its Handler paths, or the line saying which two Elements share one. */
export function placedOf(service: BuiltService): PlacedService | Tooling {
  const placed = handlerPathsOf(service.snapshot, service.project.layout);
  switch (placed.kind) {
    case 'placed':
      return { ...service, handlerPaths: placed.paths };
    case 'colliding':
      return { kind: 'tooling', message: placed.line };
  }
}

/** The Handler paths the Handler map imports. */
export function mappedPathsOf({
  handlerPaths,
}: Pick<PlacedService, 'handlerPaths'>): readonly HandlerPath[] {
  return handlerPaths.filter(({ isMapped }) => isMapped);
}

/** The Handler paths the Handler map imports where nothing is, not even a link. */
export function missingHandlerPathsOf(
  service: Pick<PlacedService, 'project' | 'handlerPaths'>,
): readonly string[] {
  const { directory } = service.project;
  const paths = mappedPathsOf(service).map(({ path }) => path);
  return paths.filter((path) => isNothingAt(join(directory, path)));
}

/** A line for every Handler path that something other than a file holds. */
export function noFileLinesOf(
  service: Pick<PlacedService, 'project' | 'handlerPaths'>,
): readonly string[] {
  const { directory } = service.project;
  const paths = mappedPathsOf(service).map(({ path }) => path);
  const blocked = paths.filter((path) => isNoFile(join(directory, path)));
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
