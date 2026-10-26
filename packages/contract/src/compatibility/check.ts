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
import {
  definitionsStandardRejectionDifferencesOf,
  serviceStandardRejectionDifferencesOf,
} from './standard-rejections.ts';
import { subscriptionDifferencesOf } from './subscriptions.ts';

/**
 * The Compatibility Check of a declared Snapshot against its Baseline: every Change, classified.
 * A Snapshot whose published text differs from the Baseline's has at least one Change, or the
 * check throws: a difference no rule names would otherwise pass for none.
 */
export function compatibilityReportOf(
  baseline: PublishedSnapshot,
  proposed: Snapshot,
): ComparedReport {
  const changes = changesOf(baseline, proposed);
  const merged = publishedSnapshotOf(baseline, proposed, baseline.version);
  if (changes.length === 0 && hashedTextOf(merged) !== hashedTextOf(baseline)) {
    throw new Error('The Snapshot changed but no Change was found: a bug.');
  }
  return { changes };
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
    ...siteChangesOf(serviceStandardRejectionDifferencesOf(baseline, proposed)),
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
    ...definitionsStandardRejectionDifferencesOf(baseline, proposed),
  ]);
}
