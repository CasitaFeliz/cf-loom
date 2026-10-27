import {
  type DeclaredElement,
  type EndpointTombstone,
  isDeclared,
  isSubscriptionTombstone,
  type MessageTombstone,
  type PublishedDefinitionsSnapshot,
  type PublishedServiceSnapshot,
} from './published.ts';
import type {
  ByKey,
  CommandSnapshot,
  DefinitionsSnapshot,
  EndpointSnapshot,
  EventSnapshot,
  ServiceSnapshot,
  SubscriptionSnapshot,
} from './types.ts';

/** A Service's or a Definitions Package's Snapshot, declared or published: the Snapshots that hold schemas. */
export type SchemaHolder =
  | ServiceSnapshot
  | DefinitionsSnapshot
  | PublishedServiceSnapshot
  | PublishedDefinitionsSnapshot;

/** A map's value with the key it sits under. */
export type Keyed<Value> = readonly [string, Value];

/** The Endpoints of a Service that are still declared, by identity; a tombstone is none. */
export function declaredEndpointsOf(snapshot: SchemaHolder): readonly Keyed<EndpointSnapshot>[] {
  return snapshot.kind === 'service' ? declaredIn<EndpointSnapshot>(snapshot.endpoints) : [];
}

/** The Message Versions of one map that are still declared, by identity. */
export function declaredMessagesOf(
  messages: ByKey<EventSnapshot | CommandSnapshot | MessageTombstone>,
): readonly Keyed<EventSnapshot | CommandSnapshot>[] {
  return declaredIn<EventSnapshot | CommandSnapshot>(messages);
}

function declaredIn<Element extends DeclaredElement>(
  elements: ByKey<Element | EndpointTombstone | MessageTombstone>,
): readonly Keyed<Element>[] {
  const declared: Keyed<Element>[] = [];
  for (const [key, element] of Object.entries(elements)) {
    if (isDeclared<Element>(element)) {
      declared.push([key, element]);
    }
  }
  return declared;
}

/** The Subscriptions that are not removed ones' tombstones, by name. */
export function declaredSubscriptionsOf(
  subscriptions: PublishedServiceSnapshot['subscriptions'],
): readonly Keyed<SubscriptionSnapshot>[] {
  const declared: Keyed<SubscriptionSnapshot>[] = [];
  for (const [name, subscription] of Object.entries(subscriptions)) {
    if (!isSubscriptionTombstone(subscription)) {
      declared.push([name, subscription]);
    }
  }
  return declared;
}
