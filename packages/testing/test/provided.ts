import { type Endpoint, type Provided, providedEndpoint } from '@cf-loom/contract';

/** An Endpoint a Contract Package may export: Public or Internal. */
export type Exportable = Endpoint & { readonly visibility: 'public' | 'internal' };

/** Endpoints as `provider`'s Contract Package exports them: each rebuilt from its declaration and marked as the Provider's. */
export function providedEndpointsOf<const Endpoints extends Readonly<Record<string, Exportable>>>(
  provider: string,
  endpoints: Endpoints,
): { readonly [Key in keyof Endpoints]: Provided<Endpoints[Key]> } {
  const entries = Object.entries(endpoints).map(([key, endpoint]) => [
    key,
    providedEndpoint(provider, endpoint),
  ]);
  return Object.fromEntries(entries);
}
