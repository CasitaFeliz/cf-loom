import {
  addedStandardRejectionNames,
  byCodePoint,
  type EndpointSnapshot,
  type ServiceSnapshot,
} from '@casitafeliz/loom-contract/internal';

/** An Endpoint the package exports, with the identity the Snapshot keys it by. */
export type ExportedEndpoint = { readonly id: string; readonly endpoint: EndpointSnapshot };

/** A Rejection an Endpoint lists itself: the Standard not-found one, or a declared one by its code. */
export type ListedRejection =
  | { readonly kind: 'not-found' }
  | { readonly kind: 'declared'; readonly code: string };

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
    .filter(({ endpoint }) => isExported(endpoint))
    .sort((left, right) => byCodePoint(left.endpoint.name, right.endpoint.name));
  const guards = new Set(endpoints.flatMap(({ endpoint }) => attachedOf(endpoint)));
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

/**
 * The Rejections an Endpoint lists itself: its resolved codes but its Guards' and those
 * cf-loom's runtime adds, which it gets again by attaching its Guards.
 */
export function ownRejectionsOf(
  endpoint: EndpointSnapshot,
  snapshot: ServiceSnapshot,
): readonly ListedRejection[] {
  const { standardRejections } = snapshot;
  const added = new Set(addedStandardRejectionNames.map((name) => standardRejections[name].code));
  for (const guard of attachedOf(endpoint)) {
    for (const code of snapshot.guards[guard]?.rejections ?? []) {
      added.add(code);
    }
  }
  const own = endpoint.rejections.filter((code) => !added.has(code));
  const notFoundCode = standardRejections.notFound.code;
  return own.map(
    (code): ListedRejection =>
      code === notFoundCode ? { kind: 'not-found' } : { kind: 'declared', code },
  );
}

/** Whether a listed Rejection is a declared one, which the package writes a file for. */
export function isDeclared(
  rejection: ListedRejection,
): rejection is Extract<ListedRejection, { readonly kind: 'declared' }> {
  return rejection.kind === 'declared';
}

function attachedOf(endpoint: EndpointSnapshot): readonly string[] {
  return endpoint.guards.map(({ guard }) => guard);
}

function isExported(endpoint: EndpointSnapshot): boolean {
  return endpoint.visibility !== 'private' && endpoint.lifecycle !== 'retired';
}
