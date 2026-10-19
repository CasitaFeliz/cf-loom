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

/** A declared Endpoint or Guard, and whether the Handler map holds its Handler. */
type DeclaredHandled = { readonly handled: Handled; readonly isMapped: boolean };

/**
 * Every Endpoint and Guard a Service declares: each Endpoint, by name, mapped unless Retired,
 * then each Guard, in the canonical Snapshot's order, mapped when a mapped Endpoint attaches it.
 */
function declaredHandledOf(snapshot: ServiceSnapshot): readonly DeclaredHandled[] {
  const endpoints = Object.values(snapshot.endpoints)
    .map(
      (endpoint): DeclaredHandled => ({
        handled: { kind: 'endpoint', name: endpoint.name, group: endpoint.group },
        isMapped: endpoint.lifecycle !== 'retired',
      }),
    )
    .sort((left, right) => byCodePoint(left.handled.name, right.handled.name));
  const live = Object.values(snapshot.endpoints).filter(({ lifecycle }) => lifecycle !== 'retired');
  const attached = new Set(live.flatMap(({ guards }) => guards.map(({ guard }) => guard)));
  const guards = Object.keys(snapshot.guards).map(
    (name): DeclaredHandled => ({ handled: { kind: 'guard', name }, isMapped: attached.has(name) }),
  );
  return [...endpoints, ...guards];
}

/** What the Handler map holds: every Endpoint that is not Retired, then every Guard those attach. */
export function handledOf(snapshot: ServiceSnapshot): readonly Handled[] {
  return declaredHandledOf(snapshot)
    .filter(({ isMapped }) => isMapped)
    .map(({ handled }) => handled);
}

/**
 * The Handler paths a Service's declarations name, a Retired Endpoint's and the Guards only it
 * attaches included, so any other Handler file is an orphan.
 */
export function namedHandlerPathsOf(snapshot: ServiceSnapshot): ReadonlySet<string> {
  return new Set(declaredHandledOf(snapshot).map(({ handled }) => handlerPathOf(handled)));
}
