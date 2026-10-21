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
 * order; a tombstone the proposed map leaves out is carried silently, so it makes no pair.
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
      return isDeclared(counterpart.baseline)
        ? { kind: 'kept', identity, baseline: counterpart.baseline, proposed: counterpart.proposed }
        : { kind: 'reused', identity, proposed: counterpart.proposed };
  }
}
