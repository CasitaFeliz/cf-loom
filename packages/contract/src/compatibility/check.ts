import {
  type DefinitionsSnapshot,
  type EndpointSnapshot,
  type EventSnapshot,
  hashedTextOf,
  type PublishedDefinitionsSnapshot,
  type PublishedServiceSnapshot,
  type PublishedSnapshot,
  type ServiceSnapshot,
  type Snapshot,
} from '../snapshot/index.ts';
import { messageBodyDifferencesOf } from './bodies.ts';
import { classificationOf } from './classes.ts';
import { definitionsCodeDifferencesOf, serviceCodeDifferencesOf } from './codes.ts';
import { endpointDifferencesOf } from './endpoints.ts';
import { type BothDefs, bothDefsOf } from './findings.ts';
import {
  type DependencyGraph,
  type Dependents,
  dependenciesLosingReach,
  dependenciesOn,
  type LosingReach,
} from './graph.ts';
import { guardDifferencesOf } from './guards.ts';
import { lifecycleDifferenceOf } from './lifecycle.ts';
import { publishedSnapshotOf } from './merge.ts';
import { historyDifferencesOf, type MessageHistory, messageHistoryOf } from './message-history.ts';
import { type Pair, pairsOf } from './pairs.ts';
import { presenceDifferenceOf } from './presence.ts';
import { renameDifferenceOf } from './renames.ts';
import type {
  Change,
  ChangeSite,
  CompatibilityReport,
  Difference,
  SiteDifferences,
} from './report.ts';
import { type EndpointPaths, endpointPathsOf, shadowingDifferencesOf } from './shadowing.ts';
import { sharedSchemaDifferencesOf } from './shared-schemas.ts';
import { subscriptionDifferencesOf } from './subscriptions.ts';
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
      ...siteChangesOf(serviceCodeDifferencesOf(baseline, proposed)),
      ...siteChangesOf(subscriptionDifferencesOf(baseline, proposed)),
    ];
  }
  if (baseline.kind === 'definitions' && proposed.kind === 'definitions') {
    return definitionsChangesOf(baseline, proposed);
  }
  return [];
}

/** A Definitions Package has no Elements: its shared schemas, Guards and codes are what its Changes are on. */
function definitionsChangesOf(
  baseline: PublishedDefinitionsSnapshot,
  proposed: DefinitionsSnapshot,
): readonly Change[] {
  return siteChangesOf([
    ...sharedSchemaDifferencesOf(baseline, proposed),
    ...guardDifferencesOf(baseline, proposed),
    ...definitionsCodeDifferencesOf(baseline, proposed),
  ]);
}

function siteChangesOf(sites: readonly SiteDifferences[]): readonly Change[] {
  return sites.flatMap(({ site, differences }) => changesAt(site, differences));
}

/** What the rules judging a Service's Endpoints read of the graph and the two Snapshots, computed once. */
type EndpointContext = {
  readonly dependents: Dependents;
  readonly losingReach: LosingReach;
  readonly defs: BothDefs;
  readonly paths: EndpointPaths;
};

function endpointChangesOf(
  baseline: PublishedServiceSnapshot,
  proposed: ServiceSnapshot,
  graph: DependencyGraph,
): readonly Change[] {
  const service = baseline.name;
  const context: EndpointContext = {
    dependents: (identity) => dependenciesOn(graph, service, { kind: 'endpoint', identity }),
    losingReach: (identity, to) =>
      dependenciesLosingReach(graph, service, { kind: 'endpoint', identity, to }),
    defs: bothDefsOf(baseline, proposed),
    paths: endpointPathsOf(baseline, proposed),
  };
  return pairsOf(baseline.endpoints, proposed.endpoints).flatMap((pair) =>
    endpointPairChangesOf(pair, context),
  );
}

function endpointPairChangesOf(
  pair: Pair<EndpointSnapshot>,
  context: EndpointContext,
): readonly Change[] {
  const visibility = siteVisibilityOf(pair);
  const site: ChangeSite = { kind: 'endpoint', identity: pair.identity, visibility };
  return changesAt(site, [
    presenceDifferenceOf(pair),
    lifecycleDifferenceOf(pair, context.dependents),
    visibilityDifferenceOf(pair, context.losingReach),
    renameDifferenceOf(pair, context.dependents),
    ...shadowingDifferencesOf(pair, context.paths),
    ...endpointDifferencesOf(pair, context.defs),
  ]);
}

/** What the rules judging a Service's Events read of the graph and the two Snapshots, computed once. */
type EventContext = {
  readonly dependents: Dependents;
  readonly losingReach: LosingReach;
  readonly defs: BothDefs;
  readonly history: MessageHistory;
};

function eventChangesOf(
  baseline: PublishedServiceSnapshot,
  proposed: ServiceSnapshot,
  graph: DependencyGraph,
): readonly Change[] {
  const service = baseline.name;
  const context: EventContext = {
    dependents: (identity) => dependenciesOn(graph, service, { kind: 'event', identity }),
    losingReach: (identity, to) =>
      dependenciesLosingReach(graph, service, { kind: 'event', identity, to }),
    defs: bothDefsOf(baseline, proposed),
    history: messageHistoryOf(baseline, proposed, 'event'),
  };
  return pairsOf(baseline.events, proposed.events).flatMap((pair) =>
    eventPairChangesOf(pair, context),
  );
}

function eventPairChangesOf(pair: Pair<EventSnapshot>, context: EventContext): readonly Change[] {
  const visibility = siteVisibilityOf(pair);
  const site: ChangeSite = { kind: 'event', identity: pair.identity, visibility };
  return changesAt(site, [
    presenceDifferenceOf(pair),
    ...historyDifferencesOf(pair, context.history),
    lifecycleDifferenceOf(pair, context.dependents),
    visibilityDifferenceOf(pair, context.losingReach),
    ...messageBodyDifferencesOf(pair, context.defs),
  ]);
}

/** A Command is always Private, so no Contract depends on one. */
function commandChangesOf(
  baseline: PublishedServiceSnapshot,
  proposed: ServiceSnapshot,
): readonly Change[] {
  const noDependents: Dependents = () => [];
  const defs = bothDefsOf(baseline, proposed);
  const history = messageHistoryOf(baseline, proposed, 'command');
  return pairsOf(baseline.commands, proposed.commands).flatMap((pair) =>
    changesAt({ kind: 'command', identity: pair.identity }, [
      presenceDifferenceOf(pair),
      ...historyDifferencesOf(pair, history),
      lifecycleDifferenceOf(pair, noDependents),
      ...messageBodyDifferencesOf(pair, defs),
    ]),
  );
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
