import { type Endpoint, type Provided, providedEndpoint } from '@cf-loom/contract';
import { exportedCutOf, identityOf, type ServiceSnapshot } from '@cf-loom/contract/internal';

/** An Endpoint a Contract Package may export: Public or Internal. */
export type Exportable = Endpoint & { readonly visibility: 'public' | 'internal' };

/**
 * Endpoints as `provider`'s Contract Package exports them: each rebuilt from its declaration, marked
 * as the Provider's and carrying the exported Snapshot cut to it from `snapshot`.
 */
export function providedEndpointsOf<const Endpoints extends Readonly<Record<string, Exportable>>>(
  provider: string,
  endpoints: Endpoints,
  snapshot: ServiceSnapshot,
): { readonly [Key in keyof Endpoints]: Provided<Endpoints[Key]> } {
  const entries = Object.entries(endpoints).map(([key, endpoint]) => {
    const cut = exportedCutOf(snapshot, identityOf(endpoint.method, endpoint.path));
    return [key, providedEndpoint(provider, endpoint, cut)];
  });
  return Object.fromEntries(entries);
}
