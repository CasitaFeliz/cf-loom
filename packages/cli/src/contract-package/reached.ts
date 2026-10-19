import {
  byCodePoint,
  type EndpointSnapshot,
  isExportedEndpoint,
  type ListedRejection,
  ownRejectionsOf,
  type ServiceSnapshot,
} from '@casitafeliz/loom-contract/internal';

/** An Endpoint the package exports, with the identity the Snapshot keys it by. */
export type ExportedEndpoint = { readonly id: string; readonly endpoint: EndpointSnapshot };

/**
 * What a Contract Package carries of a Service, and nothing else, so nothing Private leaks: its
 * Public and Internal Endpoints that are not Retired, the Guards they attach and the codes those
 * answer, Endpoints by name, the others in the canonical Snapshot's order.
 */
export type Reached = {
  readonly endpoints: readonly ExportedEndpoint[];
  readonly guards: readonly string[];
  readonly codes: readonly string[];
};

/** What a Service's Contract Package exports and the declarations those reach. */
export function reachedOf(snapshot: ServiceSnapshot): Reached {
  const endpoints = Object.entries(snapshot.endpoints)
    .map(([id, endpoint]): ExportedEndpoint => ({ id, endpoint }))
    .filter(({ endpoint }) => isExportedEndpoint(endpoint))
    .sort((left, right) => byCodePoint(left.endpoint.name, right.endpoint.name));
  const guards = new Set(
    endpoints.flatMap(({ endpoint }) => endpoint.guards.map(({ guard }) => guard)),
  );
  const guardCodes = [...guards].flatMap((guard) => snapshot.guards[guard]?.rejections ?? []);
  const listed = endpoints.flatMap(({ endpoint }) => ownRejectionsOf(endpoint, snapshot));
  const endpointCodes = listed.filter(isDeclared).map(({ code }) => code);
  const codes = new Set([...guardCodes, ...endpointCodes]);
  return {
    endpoints,
    guards: Object.keys(snapshot.guards).filter((guard) => guards.has(guard)),
    codes: Object.keys(snapshot.codes).filter((code) => codes.has(code)),
  };
}

/** Whether a listed Rejection is a declared one, which the package writes a file for. */
export function isDeclared(
  rejection: ListedRejection,
): rejection is Extract<ListedRejection, { readonly kind: 'declared' }> {
  return rejection.kind === 'declared';
}
