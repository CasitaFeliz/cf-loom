import {
  type ByKey,
  type DeclaredElement,
  type EndpointTombstone,
  isDeclared,
  type MessageTombstone,
  type PublishedElement,
} from '../snapshot/index.ts';
import { type Counterpart, counterpartsOf } from './counterparts.ts';

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
 * order; a tombstone the proposed map leaves out, or an Element Retired on both sides, is carried
 * silently, since nothing reads it, so it makes no pair.
 */
export function pairsOf<Element extends DeclaredElement>(
  baseline: ByKey<PublishedElement<Element> | EndpointTombstone | MessageTombstone>,
  proposed: ByKey<Element>,
): readonly Pair<Element>[] {
  const pairs: Pair<Element>[] = [];
  for (const counterpart of counterpartsOf(baseline, proposed)) {
    const pair = pairOf(counterpart);
    if (pair !== undefined) {
      pairs.push(pair);
    }
  }
  return pairs;
}

function pairOf<Element extends DeclaredElement>(
  counterpart: Counterpart<
    PublishedElement<Element> | EndpointTombstone | MessageTombstone,
    Element
  >,
): Pair<Element> | undefined {
  const identity = counterpart.key;
  switch (counterpart.kind) {
    case 'added':
      return { kind: 'added', identity, proposed: counterpart.proposed };
    case 'removed':
      return isDeclared(counterpart.baseline)
        ? { kind: 'dropped', identity, baseline: counterpart.baseline }
        : undefined;
    case 'kept':
      return keptOf(counterpart.baseline, counterpart.proposed, identity);
  }
}

function keptOf<Element extends DeclaredElement>(
  baseline: PublishedElement<Element> | EndpointTombstone | MessageTombstone,
  proposed: Element,
  identity: string,
): Pair<Element> | undefined {
  if (!isDeclared(baseline)) {
    return { kind: 'reused', identity, proposed };
  }
  const isRetiredOnBothSides = baseline.lifecycle === 'retired' && proposed.lifecycle === 'retired';
  return isRetiredOnBothSides ? undefined : { kind: 'kept', identity, baseline, proposed };
}
