import {
  type DefinitionsSnapshot,
  hashedTextOf,
  type PublishedDefinitionsSnapshot,
  type PublishedServiceSnapshot,
  type PublishedSnapshot,
  type ServiceSnapshot,
  type Snapshot,
} from '../snapshot/index.ts';
import { siteChangesOf } from './changes.ts';
import { definitionsCodeDifferencesOf, serviceCodeDifferencesOf } from './codes.ts';
import { dependencyDifferencesOf } from './dependencies.ts';
import { commandChangesOf, endpointChangesOf, eventChangesOf } from './element-changes.ts';
import { exportDifferencesOf } from './exports.ts';
import { guardDifferencesOf, serviceGuardDifferencesOf } from './guards.ts';
import { publishedSnapshotOf } from './merge.ts';
import type { Change, ComparedReport } from './report.ts';
import { subscriptionDifferencesOf } from './subscriptions.ts';

/** The Compatibility Check of a declared Snapshot against its Baseline: every Change, classified. */
export function compatibilityReportOf(
  baseline: PublishedSnapshot,
  proposed: Snapshot,
): ComparedReport {
  const merged = publishedSnapshotOf(baseline, proposed, baseline.version);
  return {
    changes: changesOf(baseline, proposed),
    hashChanged: hashedTextOf(merged) !== hashedTextOf(baseline),
  };
}

function changesOf(baseline: PublishedSnapshot, proposed: Snapshot): readonly Change[] {
  if (baseline.kind === 'service' && proposed.kind === 'service') {
    return serviceChangesOf(baseline, proposed);
  }
  if (baseline.kind === 'application' && proposed.kind === 'application') {
    return siteChangesOf(dependencyDifferencesOf(baseline.dependencies, proposed.dependencies));
  }
  if (baseline.kind === 'definitions' && proposed.kind === 'definitions') {
    return definitionsChangesOf(baseline, proposed);
  }
  return [];
}

function serviceChangesOf(
  baseline: PublishedServiceSnapshot,
  proposed: ServiceSnapshot,
): readonly Change[] {
  return [
    ...endpointChangesOf(baseline, proposed),
    ...eventChangesOf(baseline, proposed),
    ...commandChangesOf(baseline, proposed),
    ...siteChangesOf(serviceGuardDifferencesOf(baseline, proposed)),
    ...siteChangesOf(serviceCodeDifferencesOf(baseline, proposed)),
    ...siteChangesOf(subscriptionDifferencesOf(baseline, proposed)),
    ...siteChangesOf(dependencyDifferencesOf(baseline.dependencies, proposed.dependencies)),
  ];
}

/** A Definitions Package has no Elements: its exports, Guards and codes are what its Changes are on. */
function definitionsChangesOf(
  baseline: PublishedDefinitionsSnapshot,
  proposed: DefinitionsSnapshot,
): readonly Change[] {
  return siteChangesOf([
    ...exportDifferencesOf(baseline, proposed),
    ...guardDifferencesOf(baseline, proposed),
    ...definitionsCodeDifferencesOf(baseline, proposed),
  ]);
}
