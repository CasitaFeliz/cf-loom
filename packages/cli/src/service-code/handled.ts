import type { ServiceSnapshot } from '@cf-loom/contract/internal';
import { byCodePoint, isLive, nameAndVersionOf } from '@cf-loom/contract/internal';
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

/** A declared Element with a Handler, and whether the Handler map holds its Handler. */
export type DeclaredHandled = { readonly handled: Handled; readonly isMapped: boolean };

/** Every Element a Service declares a Handler for, kind by kind, each kind in its map's order. */
export function declaredHandledOf(snapshot: ServiceSnapshot): readonly DeclaredHandled[] {
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
