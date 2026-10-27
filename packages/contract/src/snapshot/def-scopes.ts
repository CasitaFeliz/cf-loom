import type { Defs, Path, SchemaNode } from '../walker/index.ts';
import { declaredEndpointsOf, declaredMessagesOf, type SchemaHolder } from './declared.ts';
import {
  declaredCodesOf,
  type MessageTombstone,
  type RemovedCode,
  removedCodesOf,
} from './published.ts';
import type {
  ByKey,
  CommandSnapshot,
  DefinitionsSnapshot,
  EndpointSnapshot,
  EventSnapshot,
} from './types.ts';

/** A node and where it sits in the Snapshot. */
export type SnapshotNode = { readonly at: Path; readonly node: SchemaNode };

/** The defs a group of nodes' `ref`s name, where those defs sit in the Snapshot, and the nodes. */
export type DefScope = {
  readonly at: Path;
  readonly defs: Defs;
  readonly nodes: readonly SnapshotNode[];
};

type Parts = Readonly<Record<string, SchemaNode | null>>;

/**
 * Where a Snapshot's `ref`s resolve: its own `defs` for every declared node, and for each removed
 * code its own `defs`, which its headers, body and defs name.
 */
export function defScopesOf(snapshot: SchemaHolder): readonly DefScope[] {
  const own = { at: ['defs'], defs: snapshot.defs, nodes: declaredNodesOf(snapshot) };
  const removed = removedCodesOf(snapshot.codes).map(([code, held]) => removedScopeOf(code, held));
  return [own, ...removed];
}

function removedScopeOf(code: string, { headers, body, defs }: RemovedCode): DefScope {
  const at = ['codes', code, 'defs'];
  return {
    at,
    defs,
    nodes: [...partsAt(['codes', code], { headers, body }), ...partsAt(at, defs)],
  };
}

/** The node of each exported schema, at its export. */
function exportedSchemasOf(
  snapshot: Pick<DefinitionsSnapshot, 'exports'>,
): readonly SnapshotNode[] {
  const nodes: SnapshotNode[] = [];
  for (const [name, exported] of Object.entries(snapshot.exports)) {
    if (exported.kind === 'schema') {
      nodes.push(...partsAt(['exports', name], { schema: exported.schema }));
    }
  }
  return nodes;
}

/** Every schema node a Snapshot holds besides the removed codes', each where it sits. */
function declaredNodesOf(snapshot: SchemaHolder): readonly SnapshotNode[] {
  return [
    ...partsAt(['defs'], snapshot.defs),
    ...(snapshot.kind === 'definitions' ? exportedSchemasOf(snapshot) : []),
    ...declaredEndpointsOf(snapshot).flatMap(([identity, endpoint]) =>
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

function endpointNodesOf(at: Path, { input, success }: EndpointSnapshot): readonly SnapshotNode[] {
  return [
    ...partsAt([...at, 'input'], input),
    ...partsAt([...at, 'success'], { headers: success.headers, body: success.body }),
  ];
}

function messageNodesOf(messages: {
  readonly events: ByKey<EventSnapshot | MessageTombstone>;
  readonly commands: ByKey<CommandSnapshot | MessageTombstone>;
}): readonly SnapshotNode[] {
  return [
    ...declaredBodiesAt('events', messages.events),
    ...declaredBodiesAt('commands', messages.commands),
  ];
}

function declaredBodiesAt(
  section: string,
  messages: ByKey<EventSnapshot | CommandSnapshot | MessageTombstone>,
): readonly SnapshotNode[] {
  return declaredMessagesOf(messages).map(([identity, { body }]) => ({
    at: [section, identity, 'body'],
    node: body,
  }));
}

/** The parts that hold a node, each where it sits under `at`. */
function partsAt(at: Path, parts: Parts): readonly SnapshotNode[] {
  const present = Object.entries(parts).filter(isPresent);
  return present.map(([key, node]) => ({ at: [...at, key], node }));
}

function isPresent(part: [string, SchemaNode | null]): part is [string, SchemaNode] {
  return part[1] !== null;
}
