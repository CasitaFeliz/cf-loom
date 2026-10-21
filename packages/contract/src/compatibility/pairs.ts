import {
  type ByKey,
  type DeclaredElement,
  type EndpointTombstone,
  isDeclared,
  type MessageTombstone,
  type PublishedElement,
} from '../snapshot/index.ts';
import { byCodePoint } from '../walker/index.ts';

/**
 * An Element by identity as the Baseline and the proposed Snapshot hold it: added, kept, dropped
 * (declared in the Baseline only), or reused (declared where the Baseline holds a tombstone).
 */
export type Pair<Element> =
  | { readonly kind: 'added'; readonly identity: string; readonly proposed: Element }
  | {
      readonly kind: 'kept';
      readonly identity: string;
      readonly baseline: Element;
      readonly proposed: Element;
    }
  | { readonly kind: 'dropped'; readonly identity: string; readonly baseline: Element }
  | { readonly kind: 'reused'; readonly identity: string; readonly proposed: Element };

/**
 * Every Element of the Baseline's map and the proposed one paired by identity, in code point
 * order; a tombstone the proposed map leaves out is carried silently, so it makes no pair.
 */
export function pairsOf<Element extends DeclaredElement>(
  baseline: ByKey<PublishedElement<Element> | EndpointTombstone | MessageTombstone>,
  proposed: ByKey<Element>,
): readonly Pair<Element>[] {
  const identities = new Set([...Object.keys(baseline), ...Object.keys(proposed)]);
  const pairs: Pair<Element>[] = [];
  for (const identity of [...identities].sort(byCodePoint)) {
    const pair = pairOf(identity, baseline[identity], proposed[identity]);
    if (pair !== undefined) {
      pairs.push(pair);
    }
  }
  return pairs;
}

function pairOf<Element extends DeclaredElement>(
  identity: string,
  before: PublishedElement<Element> | EndpointTombstone | MessageTombstone | undefined,
  after: Element | undefined,
): Pair<Element> | undefined {
  const baseline = before !== undefined && isDeclared(before) ? before : undefined;
  if (after === undefined) {
    return baseline === undefined ? undefined : { kind: 'dropped', identity, baseline };
  }
  if (before === undefined) {
    return { kind: 'added', identity, proposed: after };
  }
  return baseline === undefined
    ? { kind: 'reused', identity, proposed: after }
    : { kind: 'kept', identity, baseline, proposed: after };
}
