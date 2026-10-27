import {
  isSubscriptionTombstone,
  type PublishedServiceSnapshot,
  type ServiceSnapshot,
  type SubscriptionSnapshot,
  type SubscriptionTombstone,
} from '../snapshot/index.ts';
import { type Counterpart, counterpartsOf } from './counterparts.ts';
import { describedDifferencesOf } from './neutral.ts';
import type { Difference, SiteDifferences } from './report.ts';

/**
 * A Service's Subscriptions by name in code point order: added or removed, which is Neutral, a
 * removed one's name declared again, a kept one's Event changed, then its description and Group.
 */
export function subscriptionDifferencesOf(
  baseline: PublishedServiceSnapshot,
  proposed: ServiceSnapshot,
): readonly SiteDifferences[] {
  return counterpartsOf(baseline.subscriptions, proposed.subscriptions).map(
    (subscription): SiteDifferences => ({
      site: { kind: 'subscription', name: subscription.key, visibility: 'private' },
      differences: differencesOf(subscription),
    }),
  );
}

function differencesOf(
  subscription: Counterpart<SubscriptionSnapshot | SubscriptionTombstone, SubscriptionSnapshot>,
): readonly Difference[] {
  switch (subscription.kind) {
    case 'added':
      return [{ kind: 'added' }];
    case 'removed':
      return isSubscriptionTombstone(subscription.baseline) ? [] : [{ kind: 'removed' }];
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
  const event: readonly Difference[] =
    baseline.event === proposed.event
      ? []
      : [{ kind: 'event-changed', from: baseline.event, to: proposed.event }];
  return [...event, ...describedDifferencesOf(baseline, proposed)];
}
