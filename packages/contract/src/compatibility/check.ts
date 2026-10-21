import {
  type DefinitionsSnapshot,
  hashedTextOf,
  type PublishedDefinitionsSnapshot,
  type PublishedServiceSnapshot,
  type PublishedSnapshot,
  type ServiceSnapshot,
  type Snapshot,
} from '../snapshot/index.ts';
import { messageBodyDifferencesOf } from './bodies.ts';
import { classificationOf } from './classes.ts';
import { endpointDifferencesOf } from './endpoints.ts';
import { bothDefsOf } from './findings.ts';
import { type DependencyGraph, dependenciesOn } from './graph.ts';
import { lifecycleDifferenceOf } from './lifecycle.ts';
import { publishedSnapshotOf } from './merge.ts';
import { pairsOf } from './pairs.ts';
import { presenceDifferenceOf } from './presence.ts';
import { renameDifferenceOf } from './renames.ts';
import type { Change, ChangeSite, CompatibilityReport, Difference } from './report.ts';
import { sharedSchemaDifferencesOf } from './shared-schemas.ts';
import { siteVisibilityOf, visibilityDifferenceOf } from './visibility.ts';

/** The Compatibility Check of a declared Snapshot against its Baseline: every Change, classified, with the Dependencies it reaches. */
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
    changes: changesOf(baseline, proposed, graph),
    hashChanged: hashedTextOf(merged) !== hashedTextOf(baseline),
  };
}

/** An Application holds only Dependencies, so it has no Change to judge. */
function changesOf(
  baseline: PublishedSnapshot,
  proposed: Snapshot,
  graph: DependencyGraph,
): readonly Change[] {
  if (baseline.kind === 'service' && proposed.kind === 'service') {
    return [
      ...endpointChangesOf(baseline, proposed, graph),
      ...eventChangesOf(baseline, proposed, graph),
      ...commandChangesOf(baseline, proposed),
    ];
  }
  if (baseline.kind === 'definitions' && proposed.kind === 'definitions') {
    return sharedSchemaChangesOf(baseline, proposed);
  }
  return [];
}

/** A Definitions Package has no Elements: its shared schemas are what its Changes are on. */
function sharedSchemaChangesOf(
  baseline: PublishedDefinitionsSnapshot,
  proposed: DefinitionsSnapshot,
): readonly Change[] {
  return sharedSchemaDifferencesOf(baseline, proposed).flatMap(({ site, differences }) =>
    changesAt(site, differences),
  );
}

function endpointChangesOf(
  baseline: PublishedServiceSnapshot,
  proposed: ServiceSnapshot,
  graph: DependencyGraph,
): readonly Change[] {
  const dependents = (identity: string) =>
    dependenciesOn(graph, baseline.name, { kind: 'endpoint', identity });
  const defs = bothDefsOf(baseline, proposed);
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
        ...endpointDifferencesOf(pair, defs),
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
  const defs = bothDefsOf(baseline, proposed);
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
        ...messageBodyDifferencesOf(pair, defs),
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
  const defs = bothDefsOf(baseline, proposed);
  const changes: Change[] = [];
  for (const pair of pairsOf(baseline.commands, proposed.commands)) {
    const site: ChangeSite = { kind: 'command', identity: pair.identity };
    changes.push(
      ...changesAt(site, [
        presenceDifferenceOf(pair),
        lifecycleDifferenceOf(pair, dependents),
        ...messageBodyDifferencesOf(pair, defs),
      ]),
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
