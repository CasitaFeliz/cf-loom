import {
  type ByKey,
  type CodeSnapshot,
  canonicalSnapshotOf,
  codeNodesOf,
  type DefinitionsSnapshot,
  isRemoved,
  isSubscriptionTombstone,
  type PublishedApplicationSnapshot,
  type PublishedCode,
  type PublishedDefinitionsSnapshot,
  type PublishedHeading,
  type PublishedServiceSnapshot,
  type PublishedSnapshot,
  type RemovedCode,
  type ServiceSnapshot,
  type Snapshot,
  type SubscriptionSnapshot,
  type SubscriptionTombstone,
} from '../snapshot/index.ts';
import { defsReachedOf } from '../walker/index.ts';
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
    codes: codesMerged(baseline, proposed.codes, version),
    subscriptions: subscriptionsMerged(baseline?.subscriptions, proposed.subscriptions, version),
  };
}

function definitionsMerged(
  baseline: PublishedDefinitionsSnapshot | undefined,
  proposed: DefinitionsSnapshot,
  heading: PublishedHeading,
): PublishedDefinitionsSnapshot {
  const codes = codesMerged(baseline, proposed.codes, heading.version);
  return { ...proposed, ...heading, codes };
}

/**
 * A code no Endpoint answers any more stays with what it last had, removed in the version that
 * first left it out, and with the defs its body reached in the Baseline, so a later
 * version that changes a def of that name does not change what the code last had.
 */
function codesMerged(
  baseline:
    | Pick<PublishedServiceSnapshot | PublishedDefinitionsSnapshot, 'codes' | 'defs'>
    | undefined,
  proposed: ByKey<CodeSnapshot>,
  version: string,
): ByKey<PublishedCode> {
  const removed = carriedForward(baseline?.codes, proposed, (code): RemovedCode => {
    if (isRemoved(code)) {
      return code;
    }
    const defs = defsReachedOf(codeNodesOf(code), baseline?.defs ?? {});
    return { ...code, removedIn: version, defs };
  });
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
