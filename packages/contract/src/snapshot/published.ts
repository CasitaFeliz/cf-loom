import type { Lifecycle } from '../declarations/index.ts';
import type { SchemaNode } from '../walker/index.ts';
import type {
  ApplicationSnapshot,
  ByKey,
  CodeSnapshot,
  CommandSnapshot,
  DefinitionsSnapshot,
  EndpointSnapshot,
  EventSnapshot,
  InputSnapshot,
  ServiceSnapshot,
  Snapshot,
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

/** A removed Subscription, kept with its Event so its name is never reused. */
export type SubscriptionTombstone = { readonly event: string; readonly removedIn: string };

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

/** What a published Snapshot adds to the declared one's heading: its version and the CLI that wrote it. */
export type PublishedHeading = { readonly version: string; readonly generator: string };

/** The Snapshot `package` writes: the declared one with the CLI that wrote it. */
export type PackagedSnapshot = Snapshot & { readonly generator: string };

/**
 * A code no Endpoint answers any more, kept with what it last had, removed in the version that
 * first left it out, and with the defs its body reached then, which its `ref`s name.
 */
export type RemovedCode = CodeSnapshot & {
  readonly removedIn: string;
  readonly defs: ByKey<SchemaNode>;
};

/** A code in a published Snapshot: declared, or removed with its history. */
export type PublishedCode = CodeSnapshot | RemovedCode;

/**
 * An Endpoint's query and body as the versions before `removedIn` declared them, kept once a
 * publish removed a field from them, with the defs they reached then, which their `ref`s name:
 * Callers built on those versions still send this Input, so what the Endpoint declares again is
 * compared with it.
 */
export type FormerInput = {
  readonly endpoint: string;
  readonly removedIn: string;
  readonly input: Pick<InputSnapshot, 'query' | 'body'>;
  readonly defs: ByKey<SchemaNode>;
};

/** The published Snapshot of a Service: its declared Snapshot with its heading and the history only the Baseline knows. */
export type PublishedServiceSnapshot = Omit<
  ServiceSnapshot,
  'endpoints' | 'events' | 'commands' | 'subscriptions' | 'codes'
> &
  PublishedHeading & {
    readonly endpoints: ByKey<PublishedEndpoint>;
    readonly events: ByKey<PublishedEvent>;
    readonly commands: ByKey<PublishedCommand>;
    readonly codes: ByKey<PublishedCode>;
    readonly subscriptions: ByKey<SubscriptionSnapshot | SubscriptionTombstone>;
    /** The former Inputs of its Endpoints, by Endpoint in code point order, each Endpoint's in the order recorded. */
    readonly formerInputs: readonly FormerInput[];
  };

/** The published Snapshot of an Application: its Dependencies at a version. */
export type PublishedApplicationSnapshot = ApplicationSnapshot & PublishedHeading;

/** The published Snapshot of a Definitions Package: its declared Snapshot at a version, removed codes included. */
export type PublishedDefinitionsSnapshot = Omit<DefinitionsSnapshot, 'codes'> &
  PublishedHeading & { readonly codes: ByKey<PublishedCode> };

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

/** Whether a published code is one no Endpoint answers any more, kept with what it last had. */
export function isRemoved(code: PublishedCode): code is RemovedCode {
  return 'removedIn' in code;
}

/** The codes a published map still declares, by code. */
export function declaredCodesOf(
  codes: ByKey<PublishedCode>,
): readonly (readonly [string, CodeSnapshot])[] {
  return Object.entries(codes).filter(([, code]) => !isRemoved(code));
}

/** The codes a published map keeps as removed, by code. */
export function removedCodesOf(
  codes: ByKey<PublishedCode>,
): readonly (readonly [string, RemovedCode])[] {
  const removed: (readonly [string, RemovedCode])[] = [];
  for (const [code, held] of Object.entries(codes)) {
    if (isRemoved(held)) {
      removed.push([code, held]);
    }
  }
  return removed;
}

/** The former Inputs a Snapshot holds: a published Service Snapshot's, and none in any other. */
export function heldFormerInputsOf(snapshot: Snapshot | PublishedSnapshot): readonly FormerInput[] {
  return 'formerInputs' in snapshot ? snapshot.formerInputs : [];
}

/** An Endpoint's former Inputs, oldest first. */
export function formerInputsOf(
  snapshot: PublishedServiceSnapshot,
  endpoint: string,
): readonly FormerInput[] {
  return snapshot.formerInputs.filter((former) => former.endpoint === endpoint);
}

/** Whether a published Subscription is a removed one's tombstone rather than a declared Subscription. */
export function isSubscriptionTombstone(
  subscription: SubscriptionSnapshot | SubscriptionTombstone,
): subscription is SubscriptionTombstone {
  return 'removedIn' in subscription;
}
