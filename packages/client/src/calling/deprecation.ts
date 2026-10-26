import { deprecatedAtOfHeader, deprecationHeader } from '@cf-loom/contract/internal';
import type { CalledEndpoint } from '../endpoints/index.ts';
import type { DeprecationNotice, OnDeprecation } from './client-types.ts';

/** Without `onDeprecation`, a Deprecation goes to the console, naming the Provider, the Endpoint and when. */
export function warnDeprecation({ provider, endpoint, deprecatedAt }: DeprecationNotice): void {
  console.warn(`${provider}: ${endpoint} is Deprecated as of ${deprecatedAt}`);
}

/**
 * What one method does with each response: the first that carries a `Deprecation` instant is told,
 * once for this method of this client, so a Deprecation made after the Caller's version shows too;
 * what the hook throws goes to the console, so the Outcome is never lost.
 */
export function deprecationWatchOf(
  called: CalledEndpoint,
  onDeprecation: OnDeprecation,
): (response: Response) => void {
  let told = false;
  return (response) => {
    const header = response.headers.get(deprecationHeader);
    const deprecatedAt = header === null ? undefined : deprecatedAtOfHeader(header);
    if (told || deprecatedAt === undefined) {
      return;
    }
    told = true;
    const { provider, name: endpoint } = called;
    try {
      onDeprecation({ provider, endpoint, deprecatedAt });
    } catch (e) {
      console.error(`${provider}: ${endpoint}: onDeprecation threw`, e);
    }
  };
}
