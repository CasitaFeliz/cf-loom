import {
  type CommandSnapshot,
  declaredCodesOf,
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
import type { Path, SchemaNode } from '../walker/index.ts';

/** A node and where it sits in the Snapshot. */
export type SnapshotNode = { readonly at: Path; readonly node: SchemaNode };

/** The Snapshots whose names and nodes the decoder holds to account: a Service's and a Definitions Package's. */
export type Used = PublishedServiceSnapshot | PublishedDefinitionsSnapshot;
/** A Service's Endpoint that is still declared, Retired or not. */
export type DeclaredEndpoint = PublishedElement<EndpointSnapshot>;
type DeclaredMessage = PublishedElement<EventSnapshot> | PublishedElement<CommandSnapshot>;
/** A map's value with the key it sits under. */
export type Keyed<Value> = readonly [string, Value];
type Parts = Readonly<Record<string, SchemaNode | null>>;

/** The node of each exported schema, at its export. */
function exportedSchemasOf(snapshot: PublishedDefinitionsSnapshot): readonly SnapshotNode[] {
  const nodes: SnapshotNode[] = [];
  for (const [name, exported] of Object.entries(snapshot.exports)) {
    if (exported.kind === 'schema') {
      nodes.push(...partsAt(['exports', name], { schema: exported.schema }));
    }
  }
  return nodes;
}

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

/** Every schema node a Snapshot holds in the Snapshot's own `defs` scope, each where it sits. */
export function locatedNodesOf(
  snapshot: Used,
  endpoints: readonly Keyed<DeclaredEndpoint>[],
): readonly SnapshotNode[] {
  return [
    ...partsAt(['defs'], snapshot.defs),
    ...(snapshot.kind === 'definitions' ? exportedSchemasOf(snapshot) : []),
    ...endpoints.flatMap(([identity, endpoint]) =>
      endpointNodesOf(['endpoints', identity], endpoint),
    ),
    ...(snapshot.kind === 'service' ? messageNodesOf(snapshot) : []),
    ...Object.entries(snapshot.guards).flatMap(([name, guard]) => [
      ...partsAt(['guards', name, 'demands'], guard.demands),
      ...partsAt(['guards', name], { context: guard.context, qualifier: guard.qualifier }),
    ]),
    ...declaredCodesOf(snapshot.codes).flatMap(([code, { headers, body }]) =>
      partsAt(['codes', code], { headers, body }),
    ),
  ];
}

function endpointNodesOf(at: Path, { input, success }: DeclaredEndpoint): readonly SnapshotNode[] {
  return [
    ...partsAt([...at, 'input'], input),
    ...partsAt([...at, 'success'], { headers: success.headers, body: success.body }),
  ];
}

function messageNodesOf(snapshot: PublishedServiceSnapshot): readonly SnapshotNode[] {
  return [
    ...declaredBodiesAt('events', snapshot.events),
    ...declaredBodiesAt('commands', snapshot.commands),
  ];
}

function declaredBodiesAt(
  section: string,
  messages: Readonly<Record<string, PublishedEvent | PublishedCommand>>,
): readonly SnapshotNode[] {
  return declaredMessagesOf(messages).map(([identity, { body }]) => ({
    at: [section, identity, 'body'],
    node: body,
  }));
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

/** The parts that hold a node, each where it sits under `at`. */
export function partsAt(at: Path, parts: Parts): readonly SnapshotNode[] {
  const present = Object.entries(parts).filter(isPresent);
  return present.map(([key, node]) => ({ at: [...at, key], node }));
}

function isPresent(part: [string, SchemaNode | null]): part is [string, SchemaNode] {
  return part[1] !== null;
}
