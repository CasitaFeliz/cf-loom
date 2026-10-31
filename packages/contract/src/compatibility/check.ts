import {
  type DefinitionsSnapshot,
  hashedTextOf,
  type PublishedDefinitionsSnapshot,
  type PublishedSnapshot,
  type Snapshot,
} from '../snapshot/index.ts';
import { siteChangesOf } from './changes.ts';
import { definitionsCodeDifferencesOf, serviceCodeDifferencesOf } from './codes.ts';
import { dependencyDifferencesOf } from './dependencies.ts';
import { commandChangesOf, endpointChangesOf, eventChangesOf } from './element-changes.ts';
import { exportDifferencesOf } from './exports.ts';
import { type CheckedService, checkedServiceOf } from './former-inputs.ts';
import { groupDifferencesOf } from './groups.ts';
import { guardDifferencesOf, serviceGuardDifferencesOf } from './guards.ts';
import { publishedServiceOf, publishedSnapshotOf } from './merge.ts';
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
  const { version, generator } = baseline;
  const heading = { version, generator };
  if (baseline.kind === 'service' && proposed.kind === 'service') {
    const checked = checkedServiceOf(baseline, proposed);
    return reportOf(baseline, serviceChangesOf(checked), publishedServiceOf(checked, heading));
  }
  const changes = otherChangesOf(baseline, proposed);
  return reportOf(baseline, changes, publishedSnapshotOf(baseline, proposed, heading));
}

/** The report of a Check: its Changes, or a bug when the published Snapshot differs and no Change names it. */
function reportOf(
  baseline: PublishedSnapshot,
  changes: readonly Change[],
  merged: PublishedSnapshot,
): ComparedReport {
  if (changes.length === 0 && hashedTextOf(merged) !== hashedTextOf(baseline)) {
    throw new Error('The Snapshot changed but no Change was found: a bug.');
  }
  return { changes };
}

function otherChangesOf(baseline: PublishedSnapshot, proposed: Snapshot): readonly Change[] {
  if (baseline.kind === 'application' && proposed.kind === 'application') {
    return siteChangesOf(dependencyDifferencesOf(baseline.dependencies, proposed.dependencies));
  }
  if (baseline.kind === 'definitions' && proposed.kind === 'definitions') {
    return definitionsChangesOf(baseline, proposed);
  }
  return [];
}

function serviceChangesOf(checked: CheckedService): readonly Change[] {
  const { baseline, proposed } = checked;
  return [
    ...endpointChangesOf(checked),
    ...eventChangesOf(baseline, proposed),
    ...commandChangesOf(baseline, proposed),
    ...siteChangesOf(groupDifferencesOf(baseline, proposed)),
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
