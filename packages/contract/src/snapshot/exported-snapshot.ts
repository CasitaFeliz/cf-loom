import { isLive } from '../declarations/index.ts';
import { defsReachedOf } from '../walker/index.ts';
import { type EndpointPath, endpointPathOf, matchedOf, sharedUrlOf } from '../wire/index.ts';
import { reachedCodesOf } from '../written/index.ts';
import { codeNodesOf, endpointNodesOf, guardNodesOf } from './nodes.ts';
import { isDeclaredRejection, type ListedRejection, ownRejectionsOf } from './own-rejections.ts';
import {
  type EndpointTombstone,
  isDeclared,
  type MessageTombstone,
  type PublishedServiceSnapshot,
} from './published.ts';
import { reachedGuardNamesOf } from './reached-guards.ts';
import type {
  ByKey,
  EndpointSnapshot,
  EventSnapshot,
  ExportedCut,
  ExportedSnapshot,
  ServiceSnapshot,
  ShadowingSnapshot,
} from './types.ts';

/** The Endpoints and Events a cut of a Snapshot keeps, with the Guards, codes and defs they reach. */
type Kept = {
  readonly endpoints: ByKey<EndpointSnapshot>;
  readonly events: ByKey<EventSnapshot>;
};

/**
 * The Snapshot a Service's Contract Package is written from, from its declared or published
 * Snapshot: its Public and Internal Endpoints and its Internal Events that are not Retired, and
 * the Guards, codes and recursive defs they reach, keyed and ordered as in the Snapshot.
 */
export function exportedSnapshotOf(
  snapshot: ServiceSnapshot | PublishedServiceSnapshot,
): ExportedSnapshot {
  const endpoints = exportedOf(snapshot.endpoints);
  const events = exportedOf(snapshot.events);
  return cutOf(snapshot, { endpoints, events });
}

/**
 * The exported Snapshot cut to one exported Endpoint, which the Endpoint's module carries: its
 * entry, the Guards, codes and recursive defs it reaches, no Event, and the declared Endpoints that
 * win a URL it matches, so a fake picks that winner as `serve` does.
 */
export function exportedCutOf(
  snapshot: ServiceSnapshot | PublishedServiceSnapshot,
  identity: string,
): ExportedCut {
  const exported = exportedOf(snapshot.endpoints);
  const entry = Object.hasOwn(exported, identity) ? exported[identity] : undefined;
  if (entry === undefined) {
    throw new Error(`${identity} is no Endpoint a Contract Package exports`);
  }
  const { format, defs, endpoints, guards, codes } = cutOf(snapshot, {
    endpoints: { [identity]: entry },
    events: {},
  });
  return {
    format,
    defs,
    endpoints,
    guards,
    codes,
    shadowing: shadowingOf(snapshot.endpoints, identity),
  };
}

function cutOf(
  snapshot: ServiceSnapshot | PublishedServiceSnapshot,
  { endpoints, events }: Kept,
): ExportedSnapshot {
  const keptEndpoints = Object.values(endpoints);
  const attached = keptEndpoints.flatMap(({ guards }) => guards.map(({ guard }) => guard));
  const guards = keptOf(snapshot.guards, reachedGuardNamesOf(attached, snapshot.guards));
  const reachedCodes = reachedCodesOf(
    { endpoints: keptEndpoints, guards: Object.values(guards) },
    {
      ownCodesOf: (endpoint) => listedCodesOf(ownRejectionsOf(endpoint, snapshot)),
      answeredBy: ({ rejections }) => rejections,
    },
  );
  const codes = keptOf(snapshot.codes, reachedCodes);
  const nodes = [
    ...keptEndpoints.flatMap(endpointNodesOf),
    ...Object.values(events).map(({ body }) => body),
    ...Object.values(guards).flatMap(guardNodesOf),
    ...Object.values(codes).flatMap(codeNodesOf),
  ];
  const defs = defsReachedOf(nodes, snapshot.defs);
  return { format: snapshot.format, defs, endpoints, events, guards, codes };
}

/**
 * The declared Endpoints, exported or not, other than the cut's own that win a URL it matches, by
 * identity and lifecycle, so a fake picks that winner as `serve` does; a tombstone declares none.
 */
function shadowingOf(
  declared: ByKey<EndpointSnapshot | EndpointTombstone>,
  identity: string,
): ByKey<ShadowingSnapshot> {
  const entries = Object.entries(declared).filter(isKeyedDeclared);
  const routed = entries.map(([other]) => endpointPathOf(other));
  const own = endpointPathOf(identity);
  const others = entries.filter(([other]) => other !== identity);
  const carried = others.filter(([other]) => winsUrlOf(endpointPathOf(other), own, routed));
  return Object.fromEntries(carried.map(([other, { lifecycle }]) => [other, { lifecycle }]));
}

/** Whether routing picks the candidate at a URL it shares with the cut's own Endpoint. */
function winsUrlOf(
  candidate: EndpointPath,
  own: EndpointPath,
  declared: readonly EndpointPath[],
): boolean {
  const texts = sharedUrlOf(own, candidate);
  if (texts === undefined) {
    return false;
  }
  return matchedOf(declared, candidate.method, texts)?.identity === candidate.identity;
}

function isKeyedDeclared(
  keyed: [string, EndpointSnapshot | EndpointTombstone],
): keyed is [string, EndpointSnapshot] {
  return isDeclared<EndpointSnapshot>(keyed[1]);
}

/** What a Contract Package needs of an Element to export it. */
type Exportable = Pick<EndpointSnapshot, 'visibility' | 'lifecycle'> & {
  readonly description: string;
};

/** The Elements of a Snapshot map a Contract Package exports, in the map's order; a tombstone is none. */
function exportedOf<Declared extends Exportable>(
  elements: ByKey<Declared | EndpointTombstone | MessageTombstone>,
): ByKey<Declared> {
  const keyed = Object.entries(elements).filter(isKeyedExported<Declared>);
  return Object.fromEntries(keyed);
}

/** Whether a Contract Package exports an Element: declared, Public or Internal, and not Retired. */
function isKeyedExported<Declared extends Exportable>(
  keyed: [string, Declared | EndpointTombstone | MessageTombstone],
): keyed is [string, Declared] {
  const element = keyed[1];
  return isDeclared<Declared>(element) && element.visibility !== 'private' && isLive(element);
}

/** The codes an Endpoint lists itself, the Standard not-found Rejection left out. */
function listedCodesOf(listed: readonly ListedRejection[]): readonly string[] {
  return listed.filter(isDeclaredRejection).map(({ code }) => code);
}

/** The entries of a Snapshot map whose keys are kept, in the map's order. */
function keptOf<Value>(
  entries: Readonly<Record<string, Value>>,
  kept: ReadonlySet<string>,
): Readonly<Record<string, Value>> {
  return Object.fromEntries(Object.entries(entries).filter(([key]) => kept.has(key)));
}
