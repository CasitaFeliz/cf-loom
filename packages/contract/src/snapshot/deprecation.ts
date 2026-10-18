import type { Lifecycle } from '../declarations/index.ts';

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
  const endpoint = memberOf(memberOf(committed, 'endpoints'), identity);
  const stamped = memberOf(endpoint, 'deprecatedAt');
  if (isStamp(stamped)) {
    return { deprecatedAt: stamped };
  }
  return { deprecatedAt: stampOf(now) };
}

/** An instant as `generate` stamps it: ISO 8601 in UTC, to the second. */
function stampOf(instant: number): string {
  return new Date(instant).toISOString().replace(/\.\d+Z$/, 'Z');
}

/** Whether a value is a stamp `generate` could have written: one that reads back as itself. */
function isStamp(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(value)) {
    return false;
  }
  const instant = Date.parse(value);
  return !Number.isNaN(instant) && stampOf(instant) === value;
}

/** A member of a parsed JSON object, its own only; nothing for anything else. */
function memberOf(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null || !Object.hasOwn(value, key)) {
    return undefined;
  }
  return (value as Readonly<Record<string, unknown>>)[key];
}
