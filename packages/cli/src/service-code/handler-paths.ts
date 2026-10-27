import type { ServiceSnapshot } from '@cf-loom/contract/internal';
import { kebabCaseOf, messageIdentityOf } from '@cf-loom/contract/internal';
import { configFile, filledPathOf, type ServiceLayout } from '../config/index.ts';
import { contractFolder, insideContractOf, realPathOf } from '../loading/index.ts';
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
 * Where every Handler lives, or the line saying why one cannot be placed: its
 * path lies under `src/contract/`, or two share a path.
 */
export type HandlerPaths =
  | { readonly kind: 'placed'; readonly paths: readonly HandlerPath[] }
  | { readonly kind: 'unplaced'; readonly line: string };

/** The Handler path of every declaration the Handler map holds, so two never share one. */
export function handlerPathsOf(
  snapshot: ServiceSnapshot,
  layout: ServiceLayout,
  directory: string,
): HandlerPaths {
  const paths = declaredHandledOf(snapshot).map((handled) => ({
    handled,
    path: pathOf(handled, layout),
  }));
  const line = contractLineOf(paths, directory) ?? collidingLineOf(paths, directory);
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

/** The line naming the first declaration, in the map's order, whose Handler path, once filled, lies under `src/contract/`. */
function contractLineOf(paths: readonly HandlerPath[], directory: string): string | undefined {
  const isInside = insideContractOf(directory);
  const placed = paths.find(({ path }) => isInside(realPathOf(directory, path)));
  if (placed === undefined) {
    return undefined;
  }
  const under = `${handledLabelOf(placed.handled)} is ${placed.path}, under ${contractFolder}/, which holds only the Contract`;
  return `${under}: give it another path in the layout of ${configFile}`;
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
  const elements = `${handledLabelOf(earlier.handled)} and ${handledLabelOf(later.handled)}`;
  if (earlier.path === later.path) {
    return `${elements} are both ${later.path}`;
  }
  return `${elements} are both the same file, ${earlier.path} and ${later.path}`;
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
