import type { ServiceSnapshot } from '@cf-loom/contract/internal';
import { kebabCaseOf, messageIdentityOf } from '@cf-loom/contract/internal';
import {
  configFile,
  filledPathOf,
  type LayoutField,
  pathRefusalOf,
  type ServiceLayout,
} from '../config/index.ts';
import { ownedFolderOf, realPathOf } from '../loading/index.ts';
import { messageFileNameOf } from '../source-text/index.ts';
import type { LocalParts } from './code-names.ts';
import {
  type DeclarationHandled,
  declaredHandledOf,
  type Handled,
  type MessageHandled,
} from './handled.ts';

/** The Handler file of a declaration the Handler map holds a Handler for. */
export type HandlerPath = {
  readonly handled: Handled;
  readonly path: string;
};

/**
 * Where every Handler lives, or the line saying why one cannot be placed: a file of the layout
 * breaks the layout's rules once its variables are filled or through a link, or two Handlers
 * share a path.
 */
export type HandlerPaths =
  | { readonly kind: 'placed'; readonly paths: readonly HandlerPath[] }
  | { readonly kind: 'unplaced'; readonly line: string };

/** The Handler path of every declaration the Handler map holds, each meeting the layout's rules and no two sharing one. */
export function handlerPathsOf(
  snapshot: ServiceSnapshot,
  layout: ServiceLayout,
  directory: string,
): HandlerPaths {
  const paths = declaredHandledOf(snapshot).map((handled) => ({
    handled,
    path: pathOf(handled, layout),
  }));
  const line = unplacedLineOf(paths, layout, directory) ?? collidingLineOf(paths, directory);
  return line === undefined ? { kind: 'placed', paths } : { kind: 'unplaced', line };
}

/** Where a Handler lives, from its declaration's names alone, as the layout places its kind. */
function pathOf(handled: Handled, layout: ServiceLayout): string {
  switch (handled.kind) {
    case 'endpoint':
      return filledPathOf(layout.endpoint, {
        group: handled.group,
        name: kebabCaseOf(handled.name),
      });
    case 'guard':
      return filledPathOf(layout.guard, { name: kebabCaseOf(handled.name) });
    case 'command':
      return filledPathOf(layout.command, {
        group: handled.group,
        name: messageFileNameOf(handled.name),
        version: handled.version,
      });
    case 'subscription':
      return filledPathOf(layout.subscription, {
        group: handled.group,
        name: kebabCaseOf(handled.name),
      });
  }
}

/**
 * Why a path cannot hold a file of a field, as the clause a line about it ends with, or none: the
 * layout's rules for the field, then whether the path, links followed, lies where cf-loom places
 * and records files. Placing and recording both ask it, so a path is one in neither or in both.
 */
export function placementRefusalOf(
  directory: string,
): (field: LayoutField, path: string) => string | undefined {
  const isOwned = ownedFolderOf(directory);
  return (field, path) => {
    const broken = pathRefusalOf(field, path);
    if (broken !== undefined) {
      return broken;
    }
    return isOwned(realPathOf(directory, path)) ? undefined : linkRefusal;
  };
}

const linkRefusal = 'a link leads out of src/ or into src/contract/';

/** A file of the layout: the field that places it, what a line calls it, and its path once filled. */
type PlacedFile = { readonly field: LayoutField; readonly subject: string; readonly path: string };

/** The line naming the first file of the layout cf-loom could not place where it says: a Handler in the map's order, then the Handler map, then the readers. */
function unplacedLineOf(
  paths: readonly HandlerPath[],
  layout: ServiceLayout,
  directory: string,
): string | undefined {
  const refusalOf = placementRefusalOf(directory);
  for (const { field, subject, path } of [...handlerFilesOf(paths), ...generatedFilesOf(layout)]) {
    const clause = refusalOf(field, path);
    if (clause !== undefined) {
      const fix = `give it another path in the layout of ${configFile}`;
      return `${subject} is ${path}, which ${clause}: ${fix}`;
    }
  }
  return undefined;
}

function handlerFilesOf(paths: readonly HandlerPath[]): readonly PlacedFile[] {
  return paths.map(({ handled, path }) => ({
    field: handled.kind,
    subject: handledLabelOf(handled),
    path,
  }));
}

function generatedFilesOf(layout: ServiceLayout): readonly PlacedFile[] {
  const fields = ['handlerMap', 'readers'] as const;
  return fields.map((field) => ({ field, subject: `layout.${field}`, path: layout[field] }));
}

/** The line naming the first two declarations, in the map's order, whose Handlers share a path. */
function collidingLineOf(paths: readonly HandlerPath[], directory: string): string | undefined {
  const placedByFile = new Map<string, HandlerPath>();
  for (const placed of paths) {
    const file = realPathOf(directory, placed.path);
    const earlier = placedByFile.get(file);
    if (earlier !== undefined) {
      return `${bothLineOf(earlier, placed)}: give each its own path in the layout of ${configFile}`;
    }
    placedByFile.set(file, placed);
  }
  return undefined;
}

/** Two declarations at one Handler file: at one path, or at two paths a link makes one file. */
function bothLineOf(earlier: HandlerPath, later: HandlerPath): string {
  const both = `${handledLabelOf(earlier.handled)} and ${handledLabelOf(later.handled)}`;
  if (earlier.path === later.path) {
    return `${both} are both ${later.path}`;
  }
  return `${both} are both the same file, ${earlier.path} and ${later.path}`;
}

/** A declaration as the lines name it: `endpoints.getOrder`, `commands.ChargeCard@1`. */
export function handledLabelOf(handled: DeclarationHandled | MessageHandled): string {
  switch (handled.kind) {
    case 'endpoint':
    case 'guard':
    case 'subscription':
      return labelOf(handled.kind, handled.name);
    case 'command':
      return labelOf(handled.kind, messageIdentityOf(handled.name, handled.version));
  }
}

/** What a recorded Handler was written for, once it is no longer declared, by its name in code: `endpoints.getOrder`, `commands.chargeCardV1`. */
export function recordedLabelOf({ kind, name }: LocalParts): string {
  return labelOf(kind, name);
}

function labelOf(kind: Handled['kind'], name: string): string {
  switch (kind) {
    case 'endpoint':
      return `endpoints.${name}`;
    case 'guard':
      return `guards.${name}`;
    case 'command':
      return `commands.${name}`;
    case 'subscription':
      return `subscriptions.${name}`;
  }
}
