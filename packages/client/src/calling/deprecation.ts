import { deprecatedAtOfHeader, deprecationHeader } from '@casitafeliz/loom-contract/internal';
import type { CalledEndpoint } from '../endpoints/index.ts';
import type { DeprecationNotice } from './client-types.ts';

/** Where a Deprecation is told: the `onDeprecation` given to `client()`, or the console. */
export type OnDeprecation = (notice: DeprecationNotice) => void;

/** Without `onDeprecation`, a Deprecation goes to the console, naming the Provider, the Endpoint and when. */
export function warnDeprecation({ provider, endpoint, deprecatedAt }: DeprecationNotice): void {
  console.warn(`${provider}: ${endpoint} is Deprecated since ${deprecatedAt}`);
}

/**
 * What one method does with each response: the first that carries a `Deprecation` instant is told,
 * once for this method of this client, so a Deprecation made after the Caller's version shows too.
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
    onDeprecation({ provider: called.provider, endpoint: called.name, deprecatedAt });
  };
}
