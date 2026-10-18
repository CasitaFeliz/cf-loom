import {
  byCodePoint,
  type EndpointSnapshot,
  type ServiceSnapshot,
} from '@casitafeliz/loom-contract/internal';

/** An Endpoint the package exports, with the identity the Snapshot keys it by. */
export type ExportedEndpoint = { readonly id: string; readonly endpoint: EndpointSnapshot };

/**
 * What a Contract Package carries of a Service, and nothing else, so nothing Private leaks: its
 * Public and Internal Endpoints that are not Retired, the Guards they attach and the codes those
 * answer, each in code point order.
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
  const endpointCodes = endpoints.flatMap(({ endpoint }) => ownCodesOf(endpoint, snapshot));
  const standardCode = snapshot.standardRejections.notFound.code;
  const codes = new Set([...guardCodes, ...endpointCodes].filter((code) => code !== standardCode));
  return { endpoints, guards: [...guards].sort(byCodePoint), codes: [...codes].sort(byCodePoint) };
}

/**
 * The codes an Endpoint lists itself, `notFound`'s included: its resolved codes but its Guards'
 * and the two cf-loom's runtime adds, which the Endpoint gets again by attaching its Guards.
 */
export function ownCodesOf(
  endpoint: EndpointSnapshot,
  snapshot: ServiceSnapshot,
): readonly string[] {
  const { invalidInput, notImplemented } = snapshot.standardRejections;
  const added = new Set([invalidInput.code, notImplemented.code]);
  for (const guard of attachedOf(endpoint)) {
    for (const code of snapshot.guards[guard]?.rejections ?? []) {
      added.add(code);
    }
  }
  return endpoint.rejections.filter((code) => !added.has(code));
}

function attachedOf(endpoint: EndpointSnapshot): readonly string[] {
  return endpoint.guards.map(({ guard }) => guard);
}

function isExported(endpoint: EndpointSnapshot): boolean {
  return endpoint.visibility !== 'private' && endpoint.lifecycle !== 'retired';
}
