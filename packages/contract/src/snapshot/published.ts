import type { Lifecycle } from '../declarations/index.ts';
import type {
  ApplicationSnapshot,
  ByKey,
  CommandSnapshot,
  DefinitionsSnapshot,
  EndpointSnapshot,
  EventSnapshot,
  ServiceSnapshot,
  SubscriptionSnapshot,
} from './types.ts';

/** A Retired Endpoint whose declaration was deleted, kept so its identity and its name are never reused. */
export type EndpointTombstone = {
  readonly lifecycle: 'retired';
  readonly retiredIn: string;
  readonly name: string;
};

/** A Retired Message Version whose declaration was deleted, kept so its identity is never reused. */
export type MessageTombstone = { readonly lifecycle: 'retired'; readonly retiredIn: string };

/** A removed Subscription, kept with its Event so its name is never reused and `broker-plan` finds its durable consumer. */
export type SubscriptionTombstone = SubscriptionSnapshot & { readonly removedIn: string };

/** A still-declared Element as published: a Retired one also names the version that first published it Retired. */
export type PublishedElement<Element extends { readonly lifecycle: Lifecycle }> =
  | (Element & { readonly lifecycle: 'active' | 'deprecated' })
  | (Element & { readonly lifecycle: 'retired'; readonly retiredIn: string });

/** An Endpoint in a published Snapshot: still declared, or its tombstone. */
export type PublishedEndpoint = PublishedElement<EndpointSnapshot> | EndpointTombstone;

/** An Event's Message Version in a published Snapshot: still declared, or its tombstone. */
export type PublishedEvent = PublishedElement<EventSnapshot> | MessageTombstone;

/** A Command's Message Version in a published Snapshot: still declared, or its tombstone. */
export type PublishedCommand = PublishedElement<CommandSnapshot> | MessageTombstone;

/** The published Snapshot of a Service: its declared Snapshot with `version` and the history only the Baseline knows. */
export type PublishedServiceSnapshot = Omit<
  ServiceSnapshot,
  'endpoints' | 'events' | 'commands' | 'subscriptions'
> & {
  readonly version: string;
  readonly endpoints: ByKey<PublishedEndpoint>;
  readonly events: ByKey<PublishedEvent>;
  readonly commands: ByKey<PublishedCommand>;
  readonly subscriptions: ByKey<SubscriptionSnapshot | SubscriptionTombstone>;
};

/** The published Snapshot of an Application: its Dependencies at a version. */
export type PublishedApplicationSnapshot = ApplicationSnapshot & { readonly version: string };

/** The published Snapshot of a Definitions Package: its declared Snapshot at a version, removed codes included. */
export type PublishedDefinitionsSnapshot = DefinitionsSnapshot & { readonly version: string };

/** A Snapshot as `publish` writes it to `snapshot.json` and `check` reads it as the Baseline. */
export type PublishedSnapshot =
  | PublishedServiceSnapshot
  | PublishedApplicationSnapshot
  | PublishedDefinitionsSnapshot;

/** What an Element declares that the published Snapshot relies on: its lifecycle, and its description, which only a declared Element holds. */
export type DeclaredElement = { readonly lifecycle: Lifecycle; readonly description: string };

/**
 * Whether a published Endpoint or Message Version is still declared, Retired or not, rather than a
 * tombstone: only a declared Element holds a description.
 */
export function isDeclared<Element extends DeclaredElement>(
  element: Element | EndpointTombstone | MessageTombstone,
): element is Element {
  return 'description' in element;
}
