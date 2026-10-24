import { checkExportedFormat } from '@cf-loom/contract/internal';
import { type AnyDependencies, calledEndpointOf } from '../endpoints/index.ts';
import { baseUrlOf } from '../request/index.ts';
import { type Calling, methodOf } from './call.ts';
import type { Client, ClientOptions, ConfiguredName, Fetch } from './client-types.ts';
import { deprecationWatchOf, warnDeprecation } from './deprecation.ts';

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
  checkExportedFormat(deps);
  const onDeprecation = options.onDeprecation ?? warnDeprecation;
  const methods = Object.entries(deps.endpoints).map(([name, endpoint]) => {
    const called = calledEndpointOf(endpoint, deps);
    return [name, methodOf(called, calling, deprecationWatchOf(called, onDeprecation))] as const;
  });
  return Object.freeze(Object.fromEntries(methods)) as Client<Deps, Configured>;
}

/** The global `fetch` as it is when a call is made, not when the client was created. */
const globalFetch: Fetch = (url, init) => fetch(url, init);
