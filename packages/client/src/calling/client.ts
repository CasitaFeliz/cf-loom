import { calledEndpointOf } from '../endpoints/index.ts';
import { baseUrlOf } from '../request/index.ts';
import { type Calling, callOf, type Fetch } from './call.ts';
import type { CallOptions, Client, ClientOptions, ConfiguredName } from './client-types.ts';
import { deprecationWatchOf, warnDeprecation } from './deprecation.ts';
import type { AnyDependencies } from './outcome-types.ts';

/**
 * A client of the Endpoints a Dependency lists, one method each, named after it: each returns the
 * Outcome and never throws for a Rejection or a Fault.
 */
export function client<
  const Deps extends AnyDependencies,
  Configured extends ConfiguredName<Deps> = never,
>(deps: Deps, options: ClientOptions<Deps, Configured>): Client<Deps, Configured> {
  const calling: Calling = {
    base: baseUrlOf(options.baseUrl),
    fetch: options.fetch ?? globalFetch,
    headers: options.headers ?? {},
    inferFault: options.inferFault,
  };
  const providing = { provider: deps.provider, standards: deps.standardRejections };
  const onDeprecation = options.onDeprecation ?? warnDeprecation;
  const methods = Object.entries(deps.endpoints).map(([name, endpoint]) => {
    const called = calledEndpointOf(endpoint, providing);
    const method = { called, watch: deprecationWatchOf(called, onDeprecation) };
    const call = (input?: unknown, options?: CallOptions) =>
      callOf(method, calling, { input, call: options });
    return [name, call] as const;
  });
  return Object.freeze(Object.fromEntries(methods)) as unknown as Client<Deps, Configured>;
}

/** The global `fetch` as it is when a call is made, not when the client was created. */
const globalFetch: Fetch = (url, init) => fetch(url, init);
