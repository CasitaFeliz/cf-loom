import { removedCodesOf } from '../snapshot/index.ts';
import {
  type Defs,
  nodesWithin,
  type Path,
  type RefNode,
  snapshotPathOf,
} from '../walker/index.ts';
import {
  declaredEndpointsOf,
  declaredMessagesOf,
  declaredSubscriptionsOf,
  type Keyed,
  locatedNodesOf,
  partsAt,
  type SnapshotNode,
  type Used,
} from './located.ts';

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

function namesAt(
  at: Path,
  names: readonly string[],
  kind: Exclude<Use['kind'], 'def'>,
): readonly Use[] {
  return names.map((name, index) => ({ kind, name, at: [...at, index] }));
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
