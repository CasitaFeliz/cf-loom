import type { Http } from '@cf-loom/contract';
import { type AnyDependency, calledEndpointOf } from '../endpoints/index.ts';
import { baseUrlOf } from '../request/index.ts';
import { type Calling, methodOf } from './call.ts';
import type { Client, ClientOptions, ConfiguredName } from './client-types.ts';
import { deprecationWatchOf, warnDeprecation } from './deprecation.ts';

/**
 * A client of the Endpoints a Dependency lists, one method each, named after it, calling its
 * Provider at `baseUrl`, an http or https URL: each returns the Outcome and never throws for a
 * Rejection or a Fault.
 */
export function client<const D extends AnyDependency, Configured extends ConfiguredName<D> = never>(
  dependency: D,
  options: ClientOptions<D, Configured>,
): Client<D, Configured> {
  const calling: Calling = {
    base: baseUrlOf(options.baseUrl),
    fetch: options.fetch ?? globalFetch,
    headers: options.headers ?? {},
    inferFault: options.inferFault,
  };
  const onDeprecation = options.onDeprecation ?? warnDeprecation;
  const methods = (dependency.endpoints ?? []).map((endpoint) => {
    const called = calledEndpointOf(endpoint, dependency.provider);
    const method = methodOf(called, calling, deprecationWatchOf(called, onDeprecation));
    return [endpoint.name, method] as const;
  });
  return Object.freeze(Object.fromEntries(methods)) as Client<D, Configured>;
}

/** The global `fetch` as it is when a call is made, not when the client was created. */
const globalFetch: Http = (request) => fetch(request);
