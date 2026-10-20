import type { ServiceSnapshot } from '@cf-loom/contract/internal';
import { byCodePoint, isLive, nameAndVersionOf } from '@cf-loom/contract/internal';
import { kebabCaseOf, messageVersionStemOf } from '../source-text/index.ts';
import { byCommandName } from './code-names.ts';

/** An Endpoint or a Guard, whose stub imports its declaration. */
export type DeclarationHandled =
  | { readonly kind: 'endpoint'; readonly name: string; readonly group: string }
  | { readonly kind: 'guard'; readonly name: string };

/** A Command's Message Version or a Subscription, whose Handler reads a Message. */
export type MessageHandled =
  | { readonly kind: 'command'; readonly name: string; readonly version: number }
  | { readonly kind: 'subscription'; readonly name: string };

/**
 * An Endpoint, a Guard, a Command's Message Version or a Subscription a Service writes a Handler
 * for, by what names its Handler file.
 */
export type Handled = DeclarationHandled | MessageHandled;

/** The folders a Service's Handlers live in, under `src/`; a `*.handler.ts` in them is a Handler. */
export const handlerFolders: readonly string[] = [
  'src/endpoints/',
  'src/guards/',
  'src/commands/',
  'src/subscriptions/',
];

/**
 * Where a Handler lives, from its Element's names alone: an Endpoint under its Group's folder, a
 * Guard, a Command's Message Version or a Subscription under its kind's folder.
 */
export function handlerPathOf(handled: Handled): string {
  switch (handled.kind) {
    case 'endpoint':
      return `src/endpoints/${handled.group}/${kebabCaseOf(handled.name)}.handler.ts`;
    case 'guard':
      return `src/guards/${kebabCaseOf(handled.name)}.handler.ts`;
    case 'command':
      return `src/commands/${messageVersionStemOf(handled)}.handler.ts`;
    case 'subscription':
      return `src/subscriptions/${handled.name}.handler.ts`;
  }
}

/** A declared Element with a Handler, and whether the Handler map holds its Handler. */
type DeclaredHandled = { readonly handled: Handled; readonly isMapped: boolean };

/** Every Element a Service declares a Handler for, kind by kind, each kind in its map's order. */
function declaredHandledOf(snapshot: ServiceSnapshot): readonly DeclaredHandled[] {
  return [
    ...declaredEndpointsOf(snapshot),
    ...declaredGuardsOf(snapshot),
    ...declaredCommandsOf(snapshot),
    ...declaredSubscriptionsOf(snapshot),
  ];
}

/** Each Endpoint, by name, mapped unless Retired. */
function declaredEndpointsOf(snapshot: ServiceSnapshot): readonly DeclaredHandled[] {
  return Object.values(snapshot.endpoints)
    .map(
      (endpoint): DeclaredHandled => ({
        handled: { kind: 'endpoint', name: endpoint.name, group: endpoint.group },
        isMapped: isLive(endpoint),
      }),
    )
    .sort((left, right) => byCodePoint(left.handled.name, right.handled.name));
}

/** Each Guard, in the canonical Snapshot's order, mapped when a mapped Endpoint attaches it. */
function declaredGuardsOf(snapshot: ServiceSnapshot): readonly DeclaredHandled[] {
  const live = Object.values(snapshot.endpoints).filter(isLive);
  const attached = new Set(live.flatMap(({ guards }) => guards.map(({ guard }) => guard)));
  return Object.keys(snapshot.guards).map(
    (name): DeclaredHandled => ({ handled: { kind: 'guard', name }, isMapped: attached.has(name) }),
  );
}

/** Each Command's Message Version, by name in code, mapped unless Retired. */
function declaredCommandsOf(snapshot: ServiceSnapshot): readonly DeclaredHandled[] {
  const commands = Object.entries(snapshot.commands).map(([identity, command]) => ({
    handled: { kind: 'command' as const, ...nameAndVersionOf(identity) },
    isMapped: isLive(command),
  }));
  return commands.sort((left, right) => byCommandName(left.handled, right.handled));
}

/** Each Subscription, in the canonical Snapshot's order, always mapped: it has no lifecycle. */
function declaredSubscriptionsOf(snapshot: ServiceSnapshot): readonly DeclaredHandled[] {
  return Object.keys(snapshot.subscriptions).map(
    (name): DeclaredHandled => ({ handled: { kind: 'subscription', name }, isMapped: true }),
  );
}

/**
 * What the Handler map holds: every Endpoint that is not Retired, every Guard those attach, every
 * Command's Message Version that is not Retired, and every Subscription.
 */
export function handledOf(snapshot: ServiceSnapshot): readonly Handled[] {
  return declaredHandledOf(snapshot)
    .filter(({ isMapped }) => isMapped)
    .map(({ handled }) => handled);
}

/** A live Deprecated Endpoint's `deprecatedAt`, by its name, as the Handler map carries it. */
export type DeprecationStamp = { readonly name: string; readonly deprecatedAt: string };

/** The `deprecatedAt` of every Deprecated Endpoint that is not Retired, by name, from the Snapshot. */
export function deprecationStampsOf(snapshot: ServiceSnapshot): readonly DeprecationStamp[] {
  const stamps: DeprecationStamp[] = [];
  for (const { name, deprecatedAt } of Object.values(snapshot.endpoints)) {
    if (deprecatedAt !== undefined) {
      stamps.push({ name, deprecatedAt });
    }
  }
  return stamps.sort((left, right) => byCodePoint(left.name, right.name));
}

/**
 * The Handler paths a Service's declarations name, a Retired Endpoint's, the Guards only it
 * attaches and a Retired Command's Message Version's included, so any other Handler file is an
 * orphan.
 */
export function namedHandlerPathsOf(snapshot: ServiceSnapshot): ReadonlySet<string> {
  return new Set(declaredHandledOf(snapshot).map(({ handled }) => handlerPathOf(handled)));
}
