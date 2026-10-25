import type { ServiceSnapshot } from '@cf-loom/contract/internal';
import { kebabCaseOf, messageIdentityOf } from '@cf-loom/contract/internal';
import { configFile, filledPathOf, type ServiceLayout } from '../config/index.ts';
import { messageFileNameOf } from '../source-text/index.ts';
import { declaredHandledOf, type Handled } from './handled.ts';

/** The Handler file of a declared Element, and whether the Handler map imports it. */
export type HandlerPath = {
  readonly handled: Handled;
  readonly path: string;
  readonly isMapped: boolean;
};

/** Where every declared Element's Handler lives, or the line saying which two share a path. */
export type HandlerPaths =
  | { readonly kind: 'placed'; readonly paths: readonly HandlerPath[] }
  | { readonly kind: 'colliding'; readonly line: string };

/**
 * The Handler path of every Element a Service declares one for, a Retired Endpoint's, the Guards
 * only it attaches and a Retired Command's Message Version's included, so any other Handler file
 * is an orphan.
 */
export function handlerPathsOf(snapshot: ServiceSnapshot, layout: ServiceLayout): HandlerPaths {
  const paths = declaredHandledOf(snapshot).map(({ handled, isMapped }) => ({
    handled,
    isMapped,
    path: pathOf(handled, layout),
  }));
  const line = collidingLineOf(paths);
  return line === undefined ? { kind: 'placed', paths } : { kind: 'colliding', line };
}

/** Where a Handler lives, from its Element's names alone, as the layout places its kind. */
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
        name: messageFileNameOf(handled.name),
        version: handled.version,
      });
    case 'subscription':
      return filledPathOf(layout.subscription, { name: kebabCaseOf(handled.name) });
  }
}

/** The line naming the first two Elements, in the map's order, whose Handlers share a path. */
function collidingLineOf(paths: readonly HandlerPath[]): string | undefined {
  const elementsByPath = new Map<string, Handled>();
  for (const { handled, path } of paths) {
    const earlier = elementsByPath.get(path);
    if (earlier !== undefined) {
      const both = `${elementLabelOf(earlier)} and ${elementLabelOf(handled)} are both ${path}`;
      return `${both}: give each its own path in the layout of ${configFile}`;
    }
    elementsByPath.set(path, handled);
  }
  return undefined;
}

/** An Element as the lines name it: `endpoints.getOrder`, `commands.ChargeCard@1`. */
function elementLabelOf(handled: Handled): string {
  switch (handled.kind) {
    case 'endpoint':
      return `endpoints.${handled.name}`;
    case 'guard':
      return `guards.${handled.name}`;
    case 'command':
      return `commands.${messageIdentityOf(handled.name, handled.version)}`;
    case 'subscription':
      return `subscriptions.${handled.name}`;
  }
}
