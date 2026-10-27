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
 * what the hook throws or rejects with goes to the console, and it is not awaited, so the Outcome
 * is never lost or held back.
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
    tellContained(onDeprecation, { provider, endpoint, deprecatedAt });
  };
}

/** The hook told, whether it returns, throws or rejects, with nothing it does escaping to the call. */
function tellContained(onDeprecation: OnDeprecation, notice: DeprecationNotice): void {
  const telling = async () => onDeprecation(notice);
  telling().catch((error: unknown) => {
    console.error(`${notice.provider}: ${notice.endpoint}: onDeprecation threw`, error);
  });
}
