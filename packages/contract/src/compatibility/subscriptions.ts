import {
  isSubscriptionTombstone,
  type PublishedServiceSnapshot,
  type ServiceSnapshot,
  type SubscriptionSnapshot,
  type SubscriptionTombstone,
} from '../snapshot/index.ts';
import { type Counterpart, counterpartsOf } from './counterparts.ts';
import type { Difference, SiteDifferences } from './report.ts';

/**
 * A Service's Subscriptions by name in code point order: a removed one's name declared again, or a
 * kept one's Event changed. Adding or removing one is Neutral, and shows only in the hash.
 */
export function subscriptionDifferencesOf(
  baseline: PublishedServiceSnapshot,
  proposed: ServiceSnapshot,
): readonly SiteDifferences[] {
  return counterpartsOf(baseline.subscriptions, proposed.subscriptions).map(
    (subscription): SiteDifferences => ({
      site: { kind: 'subscription', name: subscription.key },
      differences: differencesOf(subscription),
    }),
  );
}

function differencesOf(
  subscription: Counterpart<SubscriptionSnapshot | SubscriptionTombstone, SubscriptionSnapshot>,
): readonly Difference[] {
  switch (subscription.kind) {
    case 'added':
    case 'removed':
      return [];
    case 'kept':
      return keptDifferencesOf(subscription.baseline, subscription.proposed);
  }
}

function keptDifferencesOf(
  baseline: SubscriptionSnapshot | SubscriptionTombstone,
  proposed: SubscriptionSnapshot,
): readonly Difference[] {
  if (isSubscriptionTombstone(baseline)) {
    return [{ kind: 'identity-reused' }];
  }
  return baseline.event === proposed.event
    ? []
    : [{ kind: 'event-changed', from: baseline.event, to: proposed.event }];
}
