import type { ServiceSnapshot } from '@casitafeliz/loom-contract/internal';
import { byCodePoint } from '@casitafeliz/loom-contract/internal';
import { kebabCaseOf } from '../source-text/index.ts';

/** An Endpoint or a Guard a Service writes a Handler for, by what names its Handler file. */
export type Handled =
  | { readonly kind: 'endpoint'; readonly name: string; readonly group: string }
  | { readonly kind: 'guard'; readonly name: string };

/** The folders a Service's Handlers live in, under `src/`; a `*.handler.ts` in them is a Handler. */
export const handlerFolders: readonly string[] = [
  'src/endpoints/',
  'src/guards/',
  'src/commands/',
  'src/subscriptions/',
];

/**
 * Where a Handler lives, from its Element's names alone: an Endpoint under its Group's folder, a
 * Guard under `src/guards/`, each by its name in kebab-case.
 */
export function handlerPathOf(handled: Handled): string {
  switch (handled.kind) {
    case 'endpoint':
      return `src/endpoints/${handled.group}/${kebabCaseOf(handled.name)}.handler.ts`;
    case 'guard':
      return `src/guards/${kebabCaseOf(handled.name)}.handler.ts`;
  }
}

/**
 * What the handler map holds: every Endpoint that is not Retired, then every Guard those attach,
 * each in code point order of its name.
 */
export function handledOf(snapshot: ServiceSnapshot): readonly Handled[] {
  const endpoints = Object.values(snapshot.endpoints).filter(
    (endpoint) => endpoint.lifecycle !== 'retired',
  );
  const attached = new Set(
    endpoints.flatMap((endpoint) => endpoint.guards.map(({ guard }) => guard)),
  );
  const handledEndpoints = endpoints
    .map(({ name, group }): Handled => ({ kind: 'endpoint', name, group }))
    .sort((left, right) => byCodePoint(left.name, right.name));
  const handledGuards = [...attached]
    .sort(byCodePoint)
    .map((name): Handled => ({ kind: 'guard', name }));
  return [...handledEndpoints, ...handledGuards];
}

/**
 * The Handler paths a Service's declarations name, a Retired Endpoint's and the Guards only it
 * attaches included, so any other Handler file is an orphan.
 */
export function namedHandlerPathsOf(snapshot: ServiceSnapshot): ReadonlySet<string> {
  const endpoints = Object.values(snapshot.endpoints).map(
    ({ name, group }): Handled => ({ kind: 'endpoint', name, group }),
  );
  const guards = Object.keys(snapshot.guards).map((name): Handled => ({ kind: 'guard', name }));
  return new Set([...endpoints, ...guards].map(handlerPathOf));
}
