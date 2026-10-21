import {
  type ByKey,
  type CodeSnapshot,
  canonicalSnapshotOf,
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
 * The published Snapshot `publish` writes at a version: the declared Snapshot with the history only
 * the Baseline knows merged in, its tombstones, `retiredIn`, `deprecatedAt`, removed codes and
 * removed Subscriptions, in canonical order.
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

function mergedOf(
  baseline: PublishedSnapshot | undefined,
  proposed: Snapshot,
  version: string,
): PublishedSnapshot {
  switch (proposed.kind) {
    case 'service':
      return serviceMerged(baselineOf(baseline, proposed, 'service'), proposed, version);
    case 'application':
      return { ...proposed, version };
    case 'definitions':
      return {
        ...proposed,
        version,
        codes: codesMerged(baselineOf(baseline, proposed, 'definitions')?.codes, proposed.codes),
      };
  }
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
      'removedIn' in subscription ? subscription : { ...subscription, removedIn: version },
  );
  return { ...tombstones, ...proposed };
}

/** A Baseline of another kind or name is no Baseline of the proposed Snapshot: the caller checked first. */
function baselineOf<Kind extends PublishedSnapshot['kind']>(
  baseline: PublishedSnapshot | undefined,
  proposed: Snapshot & { readonly kind: Kind },
  kind: Kind,
): Extract<PublishedSnapshot, { kind: Kind }> | undefined {
  if (baseline === undefined) {
    return undefined;
  }
  if (!isOfKind(baseline, kind) || baseline.name !== proposed.name) {
    throw new Error(
      `${baseline.name} (${baseline.kind}) is no Baseline of ${proposed.name} (${proposed.kind}): a bug.`,
    );
  }
  return baseline;
}

function isOfKind<Kind extends PublishedSnapshot['kind']>(
  snapshot: PublishedSnapshot,
  kind: Kind,
): snapshot is Extract<PublishedSnapshot, { kind: Kind }> {
  return snapshot.kind === kind;
}
