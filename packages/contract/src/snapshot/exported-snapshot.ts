import { isLive } from '../declarations/index.ts';
import { reachedDefsOf, type SchemaNode } from '../walker/index.ts';
import { isDeclaredRejection, ownRejectionsOf } from './own-rejections.ts';
import { reachedGuardNamesOf } from './reached-guards.ts';
import type {
  CodeSnapshot,
  EndpointSnapshot,
  ExportedSnapshot,
  GuardSnapshot,
  ServiceSnapshot,
} from './types.ts';

/**
 * The Snapshot a Service's Contract Package exports: its Public and Internal Endpoints that are not
 * Retired, and the Guards, codes and recursive defs they reach, keyed and ordered as in the Snapshot.
 */
export function exportedSnapshotOf(snapshot: ServiceSnapshot): ExportedSnapshot {
  const endpoints = Object.fromEntries(
    Object.entries(snapshot.endpoints).filter(([, endpoint]) => isExportedEndpoint(endpoint)),
  );
  const exportedEndpoints = Object.values(endpoints);
  const attached = exportedEndpoints.flatMap(({ guards }) => guards.map(({ guard }) => guard));
  const guards = keptOf(snapshot.guards, reachedGuardNamesOf(attached, snapshot.guards));
  const codes = keptOf(snapshot.codes, reachedCodesOf(exportedEndpoints, guards, snapshot));
  const nodes = [
    ...exportedEndpoints.flatMap(endpointNodesOf),
    ...Object.values(guards).flatMap(guardNodesOf),
    ...Object.values(codes).flatMap(codeNodesOf),
  ];
  const defs = keptOf(snapshot.defs, new Set(reachedDefsOf(nodes, snapshot.defs)));
  return { format: snapshot.format, defs, endpoints, guards, codes };
}

/** Whether a Contract Package exports an Endpoint: Public or Internal, and not Retired. */
function isExportedEndpoint(endpoint: EndpointSnapshot): boolean {
  return endpoint.visibility !== 'private' && isLive(endpoint);
}

/**
 * The codes the reached Guards answer and those the Endpoints list themselves, the Standard
 * Rejections' left to `standardRejections`.
 */
function reachedCodesOf(
  endpoints: readonly EndpointSnapshot[],
  guards: ExportedSnapshot['guards'],
  snapshot: ServiceSnapshot,
): ReadonlySet<string> {
  const guardCodes = Object.values(guards).flatMap(({ rejections }) => rejections);
  const listed = endpoints.flatMap((endpoint) => ownRejectionsOf(endpoint, snapshot));
  const endpointCodes = listed.filter(isDeclaredRejection).map(({ code }) => code);
  return new Set([...guardCodes, ...endpointCodes]);
}

function endpointNodesOf({ input, success }: EndpointSnapshot): readonly SchemaNode[] {
  const { params, query, headers, body } = input;
  return [params, query, headers, body, success.headers, success.body].filter(isNode);
}

function guardNodesOf({ demands, context, qualifier }: GuardSnapshot): readonly SchemaNode[] {
  return [demands.headers, demands.query, context, qualifier].filter(isNode);
}

function codeNodesOf({ body }: CodeSnapshot): readonly SchemaNode[] {
  return [body].filter(isNode);
}

function isNode(node: SchemaNode | null): node is SchemaNode {
  return node !== null;
}

/** The entries of a Snapshot map whose keys are kept, in the map's order. */
function keptOf<Value>(
  entries: Readonly<Record<string, Value>>,
  kept: ReadonlySet<string>,
): Readonly<Record<string, Value>> {
  return Object.fromEntries(Object.entries(entries).filter(([key]) => kept.has(key)));
}
