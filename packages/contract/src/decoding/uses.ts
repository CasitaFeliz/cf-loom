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
  removedCodesOf,
  type SubscriptionSnapshot,
} from '../snapshot/index.ts';
import {
  type Defs,
  nodesWithin,
  type Path,
  type RefNode,
  type SchemaNode,
  snapshotPathOf,
} from '../walker/index.ts';

/** A node and where it sits in the Snapshot. */
type SnapshotNode = { readonly at: Path; readonly node: SchemaNode };

/**
 * A name a Snapshot uses, and where: a `ref`'s def, with the defs it resolves in, a code an
 * Endpoint or Guard lists, the code a Standard Rejection resolved to, a Guard, or the Group a
 * declared Element or Subscription names.
 */
export type Use =
  | {
      readonly kind: 'def';
      readonly name: string;
      readonly at: Path;
      readonly defs: Defs;
    }
  | {
      readonly kind: 'code' | 'standard-code' | 'guard' | 'group';
      readonly name: string;
      readonly at: Path;
    };

type Used = PublishedServiceSnapshot | PublishedDefinitionsSnapshot;
type DeclaredEndpoint = PublishedElement<EndpointSnapshot>;
type DeclaredMessage = PublishedElement<EventSnapshot> | PublishedElement<CommandSnapshot>;
type Keyed<Value> = readonly [string, Value];
type Parts = Readonly<Record<string, SchemaNode | null>>;

/** Every name a Service's or a Definitions Package's Snapshot uses: its refs, codes, Guards, then Groups. */
export function usesOf(snapshot: Used): readonly Use[] {
  const endpoints = declaredEndpointsOf(snapshot);
  const guards = Object.entries(snapshot.guards);
  return [
    ...refUsesOf(locatedNodesOf(snapshot, endpoints), snapshot.defs),
    ...removedCodeRefUsesOf(snapshot),
    ...endpoints.flatMap(([identity, { rejections }]) =>
      namesAt(['endpoints', identity, 'rejections'], rejections, 'code'),
    ),
    ...guards.flatMap(([name, { rejections }]) =>
      namesAt(['guards', name, 'rejections'], rejections, 'code'),
    ),
    ...Object.entries(snapshot.standardRejections).map(([name, code]) => ({
      kind: 'standard-code' as const,
      name: code,
      at: ['standardRejections', name],
    })),
    ...endpoints.flatMap(([identity, { guards: attached }]) =>
      attached.map(({ guard }, index) => ({
        kind: 'guard' as const,
        name: guard,
        at: ['endpoints', identity, 'guards', index, 'guard'],
      })),
    ),
    ...guards.flatMap(([name, listed]) =>
      namesAt(['guards', name, 'guards'], listed.guards, 'guard'),
    ),
    ...exportUsesOf(snapshot),
    ...groupUsesOf(snapshot),
  ];
}

/** The Group each declared Endpoint, Event, Command and Subscription of a Service names; a tombstone names none. */
function groupUsesOf(snapshot: Used): readonly Use[] {
  if (snapshot.kind !== 'service') {
    return [];
  }
  return [
    ...groupUsesAt('endpoints', declaredEndpointsOf(snapshot)),
    ...groupUsesAt('events', declaredMessagesOf(snapshot.events)),
    ...groupUsesAt('commands', declaredMessagesOf(snapshot.commands)),
    ...groupUsesAt('subscriptions', declaredSubscriptionsOf(snapshot.subscriptions)),
  ];
}

function groupUsesAt(
  section: string,
  declared: readonly Keyed<{ readonly group: string }>[],
): readonly Use[] {
  return declared.map(([key, { group }]) => ({
    kind: 'group',
    name: group,
    at: [section, key, 'group'],
  }));
}

/** The Guard or code each export of a Definitions Package names, which its Snapshot must hold. */
function exportUsesOf(snapshot: Used): readonly Use[] {
  const exports = snapshot.kind === 'definitions' ? Object.entries(snapshot.exports) : [];
  const uses: Use[] = [];
  for (const [name, exported] of exports) {
    if (exported.kind === 'guard') {
      uses.push({ kind: 'guard', name: exported.guard, at: ['exports', name, 'guard'] });
    }
    if (exported.kind === 'rejection') {
      uses.push({ kind: 'code', name: exported.code, at: ['exports', name, 'code'] });
    }
  }
  return uses;
}

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

function namesAt(
  at: Path,
  names: readonly string[],
  kind: Exclude<Use['kind'], 'def'>,
): readonly Use[] {
  return names.map((name, index) => ({ kind, name, at: [...at, index] }));
}

function declaredEndpointsOf(snapshot: Used): readonly Keyed<DeclaredEndpoint>[] {
  const declared: Keyed<DeclaredEndpoint>[] = [];
  const endpoints = snapshot.kind === 'service' ? Object.entries(snapshot.endpoints) : [];
  for (const [identity, endpoint] of endpoints) {
    if (isDeclared(endpoint)) {
      declared.push([identity, endpoint]);
    }
  }
  return declared;
}

function refUsesOf(nodes: readonly SnapshotNode[], defs: Defs): readonly Use[] {
  const within: readonly SnapshotNode[] = nodes.flatMap(({ at, node }) =>
    nodesWithin(node).map((inner) => ({
      at: [...at, ...snapshotPathOf(inner.at)],
      node: inner.node,
    })),
  );
  const refs = within.filter(isRefAt);
  return refs.map(({ at, node }) => ({ kind: 'def', name: node.name, at, defs }));
}

/** The `ref`s of a removed code and of its defs, which name the defs it holds and never the Snapshot's. */
function removedCodeRefUsesOf(snapshot: Used): readonly Use[] {
  return removedCodesOf(snapshot.codes).flatMap(([code, { headers, body, defs }]) => {
    const nodes = [
      ...partsAt(['codes', code], { headers, body }),
      ...partsAt(['codes', code, 'defs'], defs),
    ];
    return refUsesOf(nodes, defs);
  });
}

function isRefAt(located: SnapshotNode): located is { at: Path; node: RefNode } {
  return located.node.type === 'ref';
}

function locatedNodesOf(snapshot: Used, endpoints: readonly Keyed<DeclaredEndpoint>[]) {
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
function declaredMessagesOf(
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
function declaredSubscriptionsOf(
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
function partsAt(at: Path, parts: Parts): readonly SnapshotNode[] {
  const present = Object.entries(parts).filter(isPresent);
  return present.map(([key, node]) => ({ at: [...at, key], node }));
}

function isPresent(part: [string, SchemaNode | null]): part is [string, SchemaNode] {
  return part[1] !== null;
}
