import type { Lifecycle } from '../declarations/index.ts';

/** What decides an Endpoint's `deprecatedAt`: its identity, its lifecycle and the stamping inputs. */
type Deprecated = {
  readonly identity: string;
  readonly lifecycle: Lifecycle;
  readonly committed: unknown;
  readonly now: number;
};

/**
 * A Deprecated Endpoint's `deprecatedAt`: the committed Snapshot's, else the clock's, to the
 * second, so the `Deprecation` header names the instant it was first seen Deprecated.
 */
export function deprecationOf({ identity, lifecycle, committed, now }: Deprecated): {
  readonly deprecatedAt?: string;
} {
  if (lifecycle !== 'deprecated') {
    return {};
  }
  const endpoint = memberOf(memberOf(committed, 'endpoints'), identity);
  const stamped = memberOf(endpoint, 'deprecatedAt');
  if (typeof stamped === 'string') {
    return { deprecatedAt: stamped };
  }
  return { deprecatedAt: new Date(now).toISOString().replace(/\.\d+Z$/, 'Z') };
}

/** A member of a parsed JSON object, its own only; nothing for anything else. */
function memberOf(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null || !Object.hasOwn(value, key)) {
    return undefined;
  }
  return (value as Readonly<Record<string, unknown>>)[key];
}
