import { isStamp, type Lifecycle, stampOf } from '../declarations/index.ts';
import { ownOf } from '../written/index.ts';

/** What `deprecatedAt` is stamped from: the committed Snapshot's content and the clock. */
export type Stamping = { readonly committed: unknown; readonly now: number };

/** An Endpoint as its `deprecatedAt` is decided: by its identity and its lifecycle. */
type Deprecated = { readonly identity: string; readonly lifecycle: Lifecycle };

/**
 * A Deprecated Endpoint's `deprecatedAt`: the committed Snapshot's when it is a UTC instant to
 * the second, else the clock's, so the `Deprecation` header names the instant it was first seen
 * Deprecated and an edited stamp shows up as a change.
 */
export function deprecationOf(
  { identity, lifecycle }: Deprecated,
  { committed, now }: Stamping,
): { readonly deprecatedAt?: string } {
  if (lifecycle !== 'deprecated') {
    return {};
  }
  const endpoint = ownOf(ownOf(committed, 'endpoints'), identity);
  const stamped = ownOf(endpoint, 'deprecatedAt');
  if (isStamp(stamped)) {
    return { deprecatedAt: stamped };
  }
  return { deprecatedAt: stampOf(now) };
}
