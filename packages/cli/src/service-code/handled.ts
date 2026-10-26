import type { ServiceSnapshot } from '@cf-loom/contract/internal';
import { byCodePoint, isLive, nameAndVersionOf } from '@cf-loom/contract/internal';
import { byCommandName } from './code-names.ts';

/** An Endpoint or a Guard, whose Stub imports its declaration. */
export type DeclarationHandled =
  | { readonly kind: 'endpoint'; readonly name: string; readonly group: string }
  | { readonly kind: 'guard'; readonly name: string };

/** A Command's Message Version or a Subscription, whose Handler reads a Message. */
export type MessageHandled =
  | { readonly kind: 'command'; readonly name: string; readonly version: number }
  | { readonly kind: 'subscription'; readonly name: string };

/** A Command's Message Version or a Subscription with the Group that lists it, where the layout may place its Handler. */
export type PlacedMessage = MessageHandled & { readonly group: string };

/**
 * An Endpoint, a Guard, a Command's Message Version or a Subscription a Service writes a Handler
 * for, by what names its Handler file.
 */
export type Handled = DeclarationHandled | PlacedMessage;

/** Whether an Element is wanted by its lifecycle: `isLive` for one with a Handler, its opposite for one without. */
type Wanted = (element: { readonly lifecycle?: string | undefined }) => boolean;

/**
 * Every Element the Handler map holds a Handler for, kind by kind, each kind in its map's order:
 * the Endpoints and Commands' Message Versions that are not Retired, every Guard and every
 * Subscription.
 */
export function declaredHandledOf(snapshot: ServiceSnapshot): readonly Handled[] {
  return [
    ...endpointsOf(snapshot, isLive),
    ...guardsOf(snapshot),
    ...commandsOf(snapshot, isLive),
    ...subscriptionsOf(snapshot),
  ];
}

/** The Endpoints and Commands' Message Versions still declared that are Retired, which have no Handler. */
export function retiredHandledOf(snapshot: ServiceSnapshot): readonly Handled[] {
  return [...endpointsOf(snapshot, isRetired), ...commandsOf(snapshot, isRetired)];
}

function isRetired(element: { readonly lifecycle?: string | undefined }): boolean {
  return !isLive(element);
}

/** The Endpoints the lifecycle wants, by name. */
function endpointsOf(snapshot: ServiceSnapshot, wanted: Wanted): readonly Handled[] {
  return Object.values(snapshot.endpoints)
    .filter(wanted)
    .map((endpoint): Handled => ({ kind: 'endpoint', name: endpoint.name, group: endpoint.group }))
    .sort((left, right) => byCodePoint(left.name, right.name));
}

/** Each Guard, in the canonical Snapshot's order: it has no lifecycle, so no state without a Handler. */
function guardsOf(snapshot: ServiceSnapshot): readonly Handled[] {
  return Object.keys(snapshot.guards).map((name): Handled => ({ kind: 'guard', name }));
}

/** The Commands' Message Versions the lifecycle wants, by name in code. */
function commandsOf(snapshot: ServiceSnapshot, wanted: Wanted): readonly Handled[] {
  return Object.entries(snapshot.commands)
    .filter(([, command]) => wanted(command))
    .map(([identity, command]) => ({
      kind: 'command' as const,
      ...nameAndVersionOf(identity),
      group: command.group,
    }))
    .sort(byCommandName);
}

/** Each Subscription, in the canonical Snapshot's order: it has no lifecycle, so it always has a Handler. */
function subscriptionsOf(snapshot: ServiceSnapshot): readonly Handled[] {
  return Object.entries(snapshot.subscriptions).map(
    ([name, { group }]): Handled => ({ kind: 'subscription', name, group }),
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
