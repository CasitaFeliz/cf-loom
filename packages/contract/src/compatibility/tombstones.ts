import type { Lifecycle } from '../declarations/index.ts';
import {
  type ByKey,
  type DeclaredElement,
  type EndpointSnapshot,
  isDeclared,
  type MessageTombstone,
  type PublishedElement,
  type PublishedEndpoint,
} from '../snapshot/index.ts';

/** What the Baseline records of an Element, declared or tombstoned: the version it was Retired in, if it was. */
type Recorded = { readonly lifecycle: Lifecycle; readonly retiredIn?: string };

/**
 * What the Baseline carries of each of its entries the proposed map no longer holds: the entry
 * `carry` makes of it, or nothing when `carry` makes none.
 */
export function carriedForward<Held, Carried>(
  baseline: ByKey<Held> | undefined,
  proposed: ByKey<unknown>,
  carry: (held: Held) => Carried | undefined,
): ByKey<Carried> {
  const carried: Record<string, Carried> = {};
  for (const [identity, held] of Object.entries(baseline ?? {})) {
    const entry = Object.hasOwn(proposed, identity) ? undefined : carry(held);
    if (entry !== undefined) {
      carried[identity] = entry;
    }
  }
  return carried;
}

/** The Endpoints a Snapshot publishes at a version, its Retired ones stamped and its tombstones kept. */
export function endpointsMerged(
  baseline: ByKey<PublishedEndpoint> | undefined,
  proposed: ByKey<EndpointSnapshot>,
  version: string,
): ByKey<PublishedEndpoint> {
  const declared = Object.fromEntries(
    Object.entries(proposed).map(([identity, endpoint]) => [
      identity,
      withBaselineDeprecation(endpoint, baseline?.[identity]),
    ]),
  );
  const tombstones = carriedForward(baseline, proposed, endpointTombstoneOf);
  return { ...tombstones, ...stampedElements(declared, baseline, version) };
}

/** The Message Versions of one kind a Snapshot publishes at a version, as its Endpoints are. */
export function messagesMerged<Declared extends DeclaredElement>(
  baseline: ByKey<PublishedElement<Declared> | MessageTombstone> | undefined,
  proposed: ByKey<Declared>,
  version: string,
): ByKey<PublishedElement<Declared> | MessageTombstone> {
  const tombstones = carriedForward(baseline, proposed, messageTombstoneOf);
  return { ...tombstones, ...stampedElements(proposed, baseline, version) };
}

/** A Deprecated Endpoint keeps the instant the Baseline first saw it Deprecated. */
function withBaselineDeprecation(
  endpoint: EndpointSnapshot,
  baseline: PublishedEndpoint | undefined,
): EndpointSnapshot {
  const deprecatedAt =
    baseline !== undefined && isDeclared(baseline) ? baseline.deprecatedAt : undefined;
  return endpoint.lifecycle === 'deprecated' && deprecatedAt !== undefined
    ? { ...endpoint, deprecatedAt }
    : endpoint;
}

/** A Retired Element is published with the version that first published it Retired. */
function stampedElements<Declared extends { readonly lifecycle: Lifecycle }>(
  proposed: ByKey<Declared>,
  baseline: ByKey<Recorded> | undefined,
  version: string,
): ByKey<PublishedElement<Declared>> {
  const stamped = Object.entries(proposed).map(([identity, element]) => {
    const retiredIn = baseline?.[identity]?.retiredIn ?? version;
    return [identity, stampedOf(element, retiredIn)] as const;
  });
  return Object.fromEntries(stamped);
}

function stampedOf<Declared extends { readonly lifecycle: Lifecycle }>(
  element: Declared,
  retiredIn: string,
): PublishedElement<Declared> {
  return element.lifecycle === 'retired'
    ? { ...element, lifecycle: 'retired', retiredIn }
    : { ...element, lifecycle: element.lifecycle };
}

function endpointTombstoneOf(endpoint: PublishedEndpoint): PublishedEndpoint | undefined {
  if (!isDeclared(endpoint)) {
    return endpoint;
  }
  const { lifecycle, name } = endpoint;
  return lifecycle === 'retired' ? { lifecycle, retiredIn: endpoint.retiredIn, name } : undefined;
}

function messageTombstoneOf<Declared extends DeclaredElement>(
  message: PublishedElement<Declared> | MessageTombstone,
): MessageTombstone | undefined {
  if (!isDeclared(message)) {
    return message;
  }
  return message.lifecycle === 'retired'
    ? { lifecycle: 'retired', retiredIn: message.retiredIn }
    : undefined;
}
