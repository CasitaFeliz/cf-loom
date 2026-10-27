import {
  type CommandSnapshot,
  type EndpointSnapshot,
  type EventSnapshot,
  isDeclared,
  isSubscriptionTombstone,
  type PublishedCommand,
  type PublishedDefinitionsSnapshot,
  type PublishedElement,
  type PublishedEvent,
  type PublishedServiceSnapshot,
  type SubscriptionSnapshot,
} from '../snapshot/index.ts';

/** The Snapshots whose names and nodes the decoder holds to account: a Service's and a Definitions Package's. */
export type Used = PublishedServiceSnapshot | PublishedDefinitionsSnapshot;
/** A Service's Endpoint that is still declared, Retired or not. */
export type DeclaredEndpoint = PublishedElement<EndpointSnapshot>;
/** A Service's Event or Command Version that is still declared, Retired or not. */
export type DeclaredMessage = PublishedElement<EventSnapshot> | PublishedElement<CommandSnapshot>;
/** A map's value with the key it sits under. */
export type Keyed<Value> = readonly [string, Value];

/** The Endpoints of a Service that are still declared, by identity; a tombstone is none. */
export function declaredEndpointsOf(snapshot: Used): readonly Keyed<DeclaredEndpoint>[] {
  const declared: Keyed<DeclaredEndpoint>[] = [];
  const endpoints = snapshot.kind === 'service' ? Object.entries(snapshot.endpoints) : [];
  for (const [identity, endpoint] of endpoints) {
    if (isDeclared(endpoint)) {
      declared.push([identity, endpoint]);
    }
  }
  return declared;
}

/** The Message Versions of one map that are still declared, by identity. */
export function declaredMessagesOf(
  messages: Readonly<Record<string, PublishedEvent | PublishedCommand>>,
): readonly Keyed<DeclaredMessage>[] {
  const declared: Keyed<DeclaredMessage>[] = [];
  for (const [identity, message] of Object.entries(messages)) {
    if (isDeclared(message)) {
      declared.push([identity, message]);
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
