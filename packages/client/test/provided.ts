import {
  type Endpoint,
  type ProvidedEndpoint,
  type ProvidedStandardRejections,
  providedEndpoint,
} from '@cf-loom/contract';
import { exportedCutOf, identityOf, type ServiceSnapshot } from '@cf-loom/contract/internal';

/** An Endpoint a Contract Package may export: Public or Internal. */
export type Exportable = Endpoint & { readonly visibility: 'public' | 'internal' };

/**
 * Endpoints as `provider`'s Contract Package exports them: each rebuilt from its declaration,
 * carrying its Provider's name and Standard Rejections and the exported Snapshot cut to it from
 * `snapshot`.
 */
export function providedEndpointsOf<
  const Endpoints extends Readonly<Record<string, Exportable>>,
  const Name extends string,
  const Standards extends ProvidedStandardRejections,
>(
  provider: { readonly name: Name; readonly standardRejections: Standards },
  endpoints: Endpoints,
  snapshot: ServiceSnapshot,
): { readonly [Key in keyof Endpoints]: ProvidedEndpoint<Endpoints[Key], Name, Standards> } {
  const entries = Object.entries(endpoints).map(([key, endpoint]) => {
    const cut = exportedCutOf(snapshot, identityOf(endpoint.method, endpoint.path));
    return [key, providedEndpoint(provider, endpoint, cut)];
  });
  return Object.fromEntries(entries);
}
