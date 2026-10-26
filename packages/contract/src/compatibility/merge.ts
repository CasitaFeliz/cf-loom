import {
  type ByKey,
  type CodeSnapshot,
  canonicalSnapshotOf,
  type DefinitionsSnapshot,
  isSubscriptionTombstone,
  type PublishedApplicationSnapshot,
  type PublishedDefinitionsSnapshot,
  type PublishedHeading,
  type PublishedServiceSnapshot,
  type PublishedSnapshot,
  type ServiceSnapshot,
  type Snapshot,
  type SubscriptionSnapshot,
  type SubscriptionTombstone,
} from '../snapshot/index.ts';
import { carriedForward, endpointsMerged, messagesMerged } from './tombstones.ts';

/**
 * The published Snapshot `publish` writes at a version by a CLI: the declared Snapshot with the
 * Baseline's history merged in (`retiredIn`, tombstones, removed codes and removed Subscriptions),
 * in canonical order.
 */
export function publishedSnapshotOf(
  baseline: PublishedServiceSnapshot | undefined,
  proposed: ServiceSnapshot,
  heading: PublishedHeading,
): PublishedServiceSnapshot;
export function publishedSnapshotOf(
  baseline: PublishedApplicationSnapshot | undefined,
  proposed: Extract<Snapshot, { kind: 'application' }>,
  heading: PublishedHeading,
): PublishedApplicationSnapshot;
export function publishedSnapshotOf(
  baseline: PublishedDefinitionsSnapshot | undefined,
  proposed: Extract<Snapshot, { kind: 'definitions' }>,
  heading: PublishedHeading,
): PublishedDefinitionsSnapshot;
export function publishedSnapshotOf(
  baseline: PublishedSnapshot | undefined,
  proposed: Snapshot,
  heading: PublishedHeading,
): PublishedSnapshot;
export function publishedSnapshotOf(
  baseline: PublishedSnapshot | undefined,
  proposed: Snapshot,
  heading: PublishedHeading,
): PublishedSnapshot {
  return canonicalSnapshotOf(mergedOf(baseline, proposed, heading));
}

/** A Baseline of another kind or name is a bug of the caller, which checks it first, so it throws. */
function mergedOf(
  baseline: PublishedSnapshot | undefined,
  proposed: Snapshot,
  heading: PublishedHeading,
): PublishedSnapshot {
  if (baseline !== undefined && !isBaselineOf(baseline, proposed)) {
    throw new Error(
      `${baseline.name} (${baseline.kind}) is no Baseline of ${proposed.name} (${proposed.kind}): a bug.`,
    );
  }
  switch (proposed.kind) {
    case 'service':
      return serviceMerged(baseline?.kind === 'service' ? baseline : undefined, proposed, heading);
    case 'application':
      return { ...proposed, ...heading };
    case 'definitions':
      return definitionsMerged(
        baseline?.kind === 'definitions' ? baseline : undefined,
        proposed,
        heading,
      );
  }
}

function isBaselineOf(baseline: PublishedSnapshot, proposed: Snapshot): boolean {
  return baseline.kind === proposed.kind && baseline.name === proposed.name;
}

function serviceMerged(
  baseline: PublishedServiceSnapshot | undefined,
  proposed: ServiceSnapshot,
  heading: PublishedHeading,
): PublishedServiceSnapshot {
  const { version } = heading;
  return {
    ...proposed,
    ...heading,
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
  heading: PublishedHeading,
): PublishedDefinitionsSnapshot {
  return { ...proposed, ...heading, codes: codesMerged(baseline?.codes, proposed.codes) };
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
