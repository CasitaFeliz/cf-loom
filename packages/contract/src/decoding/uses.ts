import {
  type EndpointSnapshot,
  isDeclared,
  type PublishedCommand,
  type PublishedDefinitionsSnapshot,
  type PublishedElement,
  type PublishedEvent,
  type PublishedServiceSnapshot,
} from '../snapshot/index.ts';
import {
  type LocatedNode,
  nodesWithin,
  type Path,
  type RefNode,
  type SchemaNode,
} from '../walker/index.ts';

/**
 * A name a Snapshot uses, and where: a `ref`'s def, a code an Endpoint or Guard lists, the code a
 * Standard Rejection resolved to, or a Guard.
 */
export type Use = {
  readonly kind: 'def' | 'code' | 'standard-code' | 'guard';
  readonly name: string;
  readonly at: Path;
};

type Used = PublishedServiceSnapshot | PublishedDefinitionsSnapshot;
type DeclaredEndpoint = PublishedElement<EndpointSnapshot>;
type Keyed<Value> = readonly [string, Value];
type Parts = Readonly<Record<string, SchemaNode | null>>;

/** Every name a Service's or a Definitions Package's Snapshot uses: its refs, then codes, then Guards. */
export function usesOf(snapshot: Used): readonly Use[] {
  const endpoints = declaredEndpointsOf(snapshot);
  const guards = Object.entries(snapshot.guards);
  return [
    ...refUsesOf(locatedNodesOf(snapshot, endpoints)),
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
  ];
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
function exportedSchemasOf(snapshot: PublishedDefinitionsSnapshot): readonly LocatedNode[] {
  const nodes: LocatedNode[] = [];
  for (const [name, exported] of Object.entries(snapshot.exports)) {
    if (exported.kind === 'schema') {
      nodes.push(...partsAt(['exports', name], { schema: exported.schema }));
    }
  }
  return nodes;
}

function namesAt(at: Path, names: readonly string[], kind: Use['kind']): readonly Use[] {
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

function refUsesOf(nodes: readonly LocatedNode[]): readonly Use[] {
  const refs = nodes.flatMap(({ at, node }) => nodesWithin(node, at)).filter(isRefAt);
  return refs.map(({ at, node }) => ({ kind: 'def', name: node.name, at }));
}

function isRefAt(located: LocatedNode): located is { at: Path; node: RefNode } {
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
    ...Object.entries(snapshot.codes).flatMap(([code, { body }]) =>
      partsAt(['codes', code], { body }),
    ),
  ];
}

function endpointNodesOf(at: Path, { input, success }: DeclaredEndpoint): readonly LocatedNode[] {
  return [
    ...partsAt([...at, 'input'], input),
    ...partsAt([...at, 'success'], { headers: success.headers, body: success.body }),
  ];
}

function messageNodesOf(snapshot: PublishedServiceSnapshot): readonly LocatedNode[] {
  return [
    ...declaredBodiesAt('events', snapshot.events),
    ...declaredBodiesAt('commands', snapshot.commands),
  ];
}

function declaredBodiesAt(
  section: string,
  messages: Readonly<Record<string, PublishedEvent | PublishedCommand>>,
): readonly LocatedNode[] {
  const located: LocatedNode[] = [];
  for (const [identity, message] of Object.entries(messages)) {
    if (isDeclared(message)) {
      located.push({ at: [section, identity, 'body'], node: message.body });
    }
  }
  return located;
}

/** The parts that hold a node, each where it sits under `at`. */
function partsAt(at: Path, parts: Parts): readonly LocatedNode[] {
  const present = Object.entries(parts).filter(isPresent);
  return present.map(([key, node]) => ({ at: [...at, key], node }));
}

function isPresent(part: [string, SchemaNode | null]): part is [string, SchemaNode] {
  return part[1] !== null;
}
