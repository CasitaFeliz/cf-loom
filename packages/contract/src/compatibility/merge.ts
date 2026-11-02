import { unbrokenLineOf } from '../lines/index.ts';
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
import { defGraphOf } from '../walker/index.ts';
import { type CheckedService, checkedServiceOf, formerInputsMerged } from './former-inputs.ts';
import { carriedForward, endpointsMerged, messagesMerged } from './tombstones.ts';

/**
 * The published Snapshot `publish` writes at a version by a CLI: the declared Snapshot with the
 * Baseline's history merged in (`retiredIn`, tombstones, removed codes, removed Subscriptions and
 * former Inputs), in canonical order.
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
  if (baseline !== undefined) {
    assertBaselineOf(baseline, proposed);
  }
  switch (proposed.kind) {
    case 'service':
      return serviceMerged(proposed, serviceCheckedOf(baseline, proposed), heading);
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

function assertBaselineOf(baseline: PublishedSnapshot, proposed: Snapshot): void {
  if (baseline.kind !== proposed.kind || baseline.name !== proposed.name) {
    throw new Error(
      unbrokenLineOf(
        `${baseline.name} (${baseline.kind}) is no Baseline of ${proposed.name} (${proposed.kind}): a bug.`,
      ),
    );
  }
}

/** The Service checked against its Baseline, if it has one of its kind. */
function serviceCheckedOf(
  baseline: PublishedSnapshot | undefined,
  proposed: ServiceSnapshot,
): CheckedService | undefined {
  return baseline?.kind === 'service' ? checkedServiceOf(baseline, proposed) : undefined;
}

/**
 * The published Snapshot of a Service its Check has grouped the Baseline's former Inputs for, so
 * the Check and the merge group them once.
 */
export function publishedServiceOf(
  checked: CheckedService,
  heading: PublishedHeading,
): PublishedServiceSnapshot {
  assertBaselineOf(checked.baseline, checked.proposed);
  return canonicalSnapshotOf(serviceMerged(checked.proposed, checked, heading));
}

function serviceMerged(
  proposed: ServiceSnapshot,
  checked: CheckedService | undefined,
  heading: PublishedHeading,
): PublishedServiceSnapshot {
  const { version } = heading;
  const baseline = checked?.baseline;
  return {
    ...proposed,
    ...heading,
    endpoints: endpointsMerged(baseline?.endpoints, proposed.endpoints, version),
    events: messagesMerged(baseline?.events, proposed.events, version),
    commands: messagesMerged(baseline?.commands, proposed.commands, version),
    codes: codesMerged(baseline, proposed.codes, version),
    subscriptions: subscriptionsMerged(baseline?.subscriptions, proposed.subscriptions, version),
    formerInputs: checked === undefined ? [] : formerInputsMerged(checked, version),
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
    const { held: defs } = defGraphOf(baseline?.defs ?? {}).reached(codeNodesOf(code));
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
