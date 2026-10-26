import {
  type ByKey,
  type CodeSnapshot,
  canonicalSnapshotOf,
  type DefinitionsSnapshot,
  isSubscriptionTombstone,
  type PublishedApplicationSnapshot,
  type PublishedDefinitionsSnapshot,
  type PublishedServiceSnapshot,
  type PublishedSnapshot,
  type ServiceSnapshot,
  type Snapshot,
  type SubscriptionSnapshot,
  type SubscriptionTombstone,
} from '../snapshot/index.ts';
import { carriedForward, endpointsMerged, messagesMerged } from './tombstones.ts';

/**
 * The published Snapshot `publish` writes at a version: the declared Snapshot with the Baseline's
 * history merged in (`retiredIn`, tombstones, removed codes and removed Subscriptions), in
 * canonical order.
 */
export function publishedSnapshotOf(
  baseline: PublishedServiceSnapshot | undefined,
  proposed: ServiceSnapshot,
  version: string,
): PublishedServiceSnapshot;
export function publishedSnapshotOf(
  baseline: PublishedApplicationSnapshot | undefined,
  proposed: Extract<Snapshot, { kind: 'application' }>,
  version: string,
): PublishedApplicationSnapshot;
export function publishedSnapshotOf(
  baseline: PublishedDefinitionsSnapshot | undefined,
  proposed: Extract<Snapshot, { kind: 'definitions' }>,
  version: string,
): PublishedDefinitionsSnapshot;
export function publishedSnapshotOf(
  baseline: PublishedSnapshot | undefined,
  proposed: Snapshot,
  version: string,
): PublishedSnapshot;
export function publishedSnapshotOf(
  baseline: PublishedSnapshot | undefined,
  proposed: Snapshot,
  version: string,
): PublishedSnapshot {
  return canonicalSnapshotOf(mergedOf(baseline, proposed, version));
}

/** A Baseline of another kind or name is a bug of the caller, which checks it first, so it throws. */
function mergedOf(
  baseline: PublishedSnapshot | undefined,
  proposed: Snapshot,
  version: string,
): PublishedSnapshot {
  if (baseline !== undefined && !isBaselineOf(baseline, proposed)) {
    throw new Error(
      `${baseline.name} (${baseline.kind}) is no Baseline of ${proposed.name} (${proposed.kind}): a bug.`,
    );
  }
  switch (proposed.kind) {
    case 'service':
      return serviceMerged(baseline?.kind === 'service' ? baseline : undefined, proposed, version);
    case 'application':
      return { ...proposed, version };
    case 'definitions':
      return definitionsMerged(
        baseline?.kind === 'definitions' ? baseline : undefined,
        proposed,
        version,
      );
  }
}

function isBaselineOf(baseline: PublishedSnapshot, proposed: Snapshot): boolean {
  return baseline.kind === proposed.kind && baseline.name === proposed.name;
}

function serviceMerged(
  baseline: PublishedServiceSnapshot | undefined,
  proposed: ServiceSnapshot,
  version: string,
): PublishedServiceSnapshot {
  return {
    ...proposed,
    version,
    endpoints: endpointsMerged(baseline?.endpoints, proposed.endpoints, version),
    events: messagesMerged(baseline?.events, proposed.events, version),
    commands: messagesMerged(baseline?.commands, proposed.commands, version),
    codes: codesMerged(baseline?.codes, proposed.codes),
    subscriptions: subscriptionsMerged(baseline?.subscriptions, proposed.subscriptions, version),
  };
}

function definitionsMerged(
  baseline: PublishedDefinitionsSnapshot | undefined,
  proposed: DefinitionsSnapshot,
  version: string,
): PublishedDefinitionsSnapshot {
  return { ...proposed, version, codes: codesMerged(baseline?.codes, proposed.codes) };
}

/** A code no Endpoint answers any more stays, marked removed, with what it last had. */
function codesMerged(
  baseline: ByKey<CodeSnapshot> | undefined,
  proposed: ByKey<CodeSnapshot>,
): ByKey<CodeSnapshot> {
  const removed = carriedForward(baseline, proposed, (code) => ({ ...code, removed: true }));
  return { ...removed, ...proposed };
}

/** A removed Subscription stays as a tombstone with its Event, removed in the version that dropped it. */
function subscriptionsMerged(
  baseline: PublishedServiceSnapshot['subscriptions'] | undefined,
  proposed: ByKey<SubscriptionSnapshot>,
  version: string,
): PublishedServiceSnapshot['subscriptions'] {
  const tombstones = carriedForward(
    baseline,
    proposed,
    (subscription): SubscriptionSnapshot | SubscriptionTombstone =>
      isSubscriptionTombstone(subscription)
        ? subscription
        : { event: subscription.event, removedIn: version },
  );
  return { ...tombstones, ...proposed };
}
