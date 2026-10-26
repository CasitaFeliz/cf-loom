import { isLive } from '../declarations/index.ts';
import { reachedDefsOf } from '../walker/index.ts';
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
  ExportedSnapshot,
  ServiceSnapshot,
  ShadowingSnapshot,
} from './types.ts';

/**
 * The Snapshot a Service's Contract Package exports, from its declared or published Snapshot: its
 * Public and Internal Endpoints and its Internal Events that are not Retired, and the Guards, codes
 * and recursive defs they reach, keyed and ordered as in the Snapshot, and the declared Endpoints it
 * does not export that win a URL an exported one matches.
 */
export function exportedSnapshotOf(
  snapshot: ServiceSnapshot | PublishedServiceSnapshot,
): ExportedSnapshot {
  const endpoints = exportedOf(snapshot.endpoints);
  const events = exportedOf(snapshot.events);
  const exportedEndpoints = Object.values(endpoints);
  const attached = exportedEndpoints.flatMap(({ guards }) => guards.map(({ guard }) => guard));
  const guards = keptOf(snapshot.guards, reachedGuardNamesOf(attached, snapshot.guards));
  const reachedCodes = reachedCodesOf(
    { endpoints: exportedEndpoints, guards: Object.values(guards) },
    {
      ownCodesOf: (endpoint) => declaredCodesOf(ownRejectionsOf(endpoint, snapshot)),
      answeredBy: ({ rejections }) => rejections,
    },
  );
  const codes = keptOf(snapshot.codes, reachedCodes);
  const nodes = [
    ...exportedEndpoints.flatMap(endpointNodesOf),
    ...Object.values(events).map(({ body }) => body),
    ...Object.values(guards).flatMap(guardNodesOf),
    ...Object.values(codes).flatMap(codeNodesOf),
  ];
  const defs = keptOf(snapshot.defs, new Set(reachedDefsOf(nodes, snapshot.defs)));
  const shadowing = shadowingOf(snapshot.endpoints, endpoints);
  return { format: snapshot.format, defs, endpoints, events, guards, codes, shadowing };
}

/**
 * The declared Endpoints a Contract Package does not export that win a URL an exported one matches,
 * by identity and lifecycle, so a fake picks that winner as `serve` does; a tombstone declares none.
 */
function shadowingOf(
  declared: ByKey<EndpointSnapshot | EndpointTombstone>,
  exported: ByKey<EndpointSnapshot>,
): ByKey<ShadowingSnapshot> {
  const entries = Object.entries(declared).filter(isKeyedDeclared);
  const routed = entries.map(([identity]) => endpointPathOf(identity));
  const exportedRoutes = Object.keys(exported).map(endpointPathOf);
  const unexported = entries.filter(([identity]) => !Object.hasOwn(exported, identity));
  const carried = unexported.filter(([identity]) => {
    return winsAnExportedUrl(endpointPathOf(identity), exportedRoutes, routed);
  });
  return Object.fromEntries(carried.map(([identity, { lifecycle }]) => [identity, { lifecycle }]));
}

/** Whether, at a URL an exported Endpoint shares with it, the candidate is the declared Endpoint routing picks. */
function winsAnExportedUrl(
  candidate: EndpointPath,
  exported: readonly EndpointPath[],
  declared: readonly EndpointPath[],
): boolean {
  return exported.some((route) => {
    const texts = sharedUrlOf(route, candidate);
    if (texts === undefined) {
      return false;
    }
    return matchedOf(declared, candidate.method, texts)?.identity === candidate.identity;
  });
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
function declaredCodesOf(listed: readonly ListedRejection[]): readonly string[] {
  return listed.filter(isDeclaredRejection).map(({ code }) => code);
}

/** The entries of a Snapshot map whose keys are kept, in the map's order. */
function keptOf<Value>(
  entries: Readonly<Record<string, Value>>,
  kept: ReadonlySet<string>,
): Readonly<Record<string, Value>> {
  return Object.fromEntries(Object.entries(entries).filter(([key]) => kept.has(key)));
}
