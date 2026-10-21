import {
  hashedTextOf,
  type PublishedServiceSnapshot,
  type PublishedSnapshot,
  type ServiceSnapshot,
  type Snapshot,
} from '../snapshot/index.ts';
import { classificationOf } from './classes.ts';
import { type DependencyGraph, dependenciesOn } from './graph.ts';
import { lifecycleDifferenceOf } from './lifecycle.ts';
import { publishedSnapshotOf } from './merge.ts';
import { pairsOf } from './pairs.ts';
import { presenceDifferenceOf } from './presence.ts';
import { renameDifferenceOf } from './renames.ts';
import type { Change, ChangeSite, CompatibilityReport, Difference } from './report.ts';
import { siteVisibilityOf, visibilityDifferenceOf } from './visibility.ts';

/**
 * The Compatibility Check of a declared Snapshot against its Baseline: every difference on its
 * Elements classified, with the Dependencies the graph holds on what it renames or retires.
 */
export function compatibilityReportOf(
  baseline: PublishedSnapshot | undefined,
  proposed: Snapshot,
  graph: DependencyGraph,
): CompatibilityReport {
  if (baseline === undefined) {
    return { kind: 'no-baseline' };
  }
  const merged = publishedSnapshotOf(baseline, proposed, baseline.version);
  return {
    kind: 'compared',
    changes: elementChangesOf(baseline, proposed, graph),
    hashChanged: hashedTextOf(merged) !== hashedTextOf(baseline),
  };
}

/** A Definitions Package has no Elements, and an Application only Dependencies: neither has an Element Change. */
function elementChangesOf(
  baseline: PublishedSnapshot,
  proposed: Snapshot,
  graph: DependencyGraph,
): readonly Change[] {
  if (baseline.kind !== 'service' || proposed.kind !== 'service') {
    return [];
  }
  return [
    ...endpointChangesOf(baseline, proposed, graph),
    ...eventChangesOf(baseline, proposed, graph),
    ...commandChangesOf(baseline, proposed),
  ];
}

function endpointChangesOf(
  baseline: PublishedServiceSnapshot,
  proposed: ServiceSnapshot,
  graph: DependencyGraph,
): readonly Change[] {
  const dependents = (identity: string) =>
    dependenciesOn(graph, baseline.name, { kind: 'endpoint', identity });
  const changes: Change[] = [];
  for (const pair of pairsOf(baseline.endpoints, proposed.endpoints)) {
    const site: ChangeSite = {
      kind: 'endpoint',
      identity: pair.identity,
      visibility: siteVisibilityOf(pair),
    };
    changes.push(
      ...changesAt(site, [
        presenceDifferenceOf(pair),
        lifecycleDifferenceOf(pair, dependents),
        visibilityDifferenceOf(pair),
        renameDifferenceOf(pair, dependents),
      ]),
    );
  }
  return changes;
}

function eventChangesOf(
  baseline: PublishedServiceSnapshot,
  proposed: ServiceSnapshot,
  graph: DependencyGraph,
): readonly Change[] {
  const dependents = (identity: string) =>
    dependenciesOn(graph, baseline.name, { kind: 'event', identity });
  const changes: Change[] = [];
  for (const pair of pairsOf(baseline.events, proposed.events)) {
    const site: ChangeSite = {
      kind: 'event',
      identity: pair.identity,
      visibility: siteVisibilityOf(pair),
    };
    changes.push(
      ...changesAt(site, [
        presenceDifferenceOf(pair),
        lifecycleDifferenceOf(pair, dependents),
        visibilityDifferenceOf(pair),
      ]),
    );
  }
  return changes;
}

/** A Command is always Private, so no Contract depends on one. */
function commandChangesOf(
  baseline: PublishedServiceSnapshot,
  proposed: ServiceSnapshot,
): readonly Change[] {
  const dependents = () => [];
  const changes: Change[] = [];
  for (const pair of pairsOf(baseline.commands, proposed.commands)) {
    const site: ChangeSite = { kind: 'command', identity: pair.identity };
    changes.push(
      ...changesAt(site, [presenceDifferenceOf(pair), lifecycleDifferenceOf(pair, dependents)]),
    );
  }
  return changes;
}

/** The differences found at a site, in the order the rules ran, each classified as a Change. */
function changesAt(site: ChangeSite, found: readonly (Difference | undefined)[]): Change[] {
  return found.filter(isFound).map((difference) => ({
    site,
    difference,
    ...classificationOf(site, difference),
  }));
}

function isFound(difference: Difference | undefined): difference is Difference {
  return difference !== undefined;
}
