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
import { endpointDifferencesOf, endpointSiteOf } from './endpoints.ts';
import { exportDifferencesOf } from './exports.ts';
import { type BothDefs, bothDefsOf } from './findings.ts';
import { guardDifferencesOf } from './guards.ts';
import { lifecycleDifferenceOf } from './lifecycle.ts';
import { publishedSnapshotOf } from './merge.ts';
import { historyDifferencesOf, type MessageHistory, messageHistoryOf } from './message-history.ts';
import { type Pair, pairsOf } from './pairs.ts';
import { presenceDifferenceOf } from './presence.ts';
import { renameDifferenceOf } from './renames.ts';
import type { Change, ChangeSite, ComparedReport, Difference, SiteDifferences } from './report.ts';
import { type EndpointPaths, endpointPathsOf, shadowingDifferencesOf } from './shadowing.ts';
import { subscriptionDifferencesOf } from './subscriptions.ts';
import { siteVisibilityOf, visibilityDifferenceOf } from './visibility.ts';

/** The Compatibility Check of a declared Snapshot against its Baseline: every Change, classified. */
export function compatibilityReportOf(
  baseline: PublishedSnapshot,
  proposed: Snapshot,
): ComparedReport {
  const merged = publishedSnapshotOf(baseline, proposed, baseline.version);
  return {
    kind: 'compared',
    changes: changesOf(baseline, proposed),
    hashChanged: hashedTextOf(merged) !== hashedTextOf(baseline),
  };
}

/**
 * The Compatibility Check of a package with no Baseline: its declared Snapshot is the whole
 * history, so only the numbering of its Message Versions is judged, a version after one it does
 * not hold.
 */
export function firstPublishChangesOf(proposed: Snapshot): readonly Change[] {
  if (proposed.kind !== 'service') {
    return [];
  }
  const events = messageHistoryOf(noMessages, proposed, 'event');
  const commands = messageHistoryOf(noMessages, proposed, 'command');
  return [
    ...pairsOf({}, proposed.events).flatMap((pair) =>
      changesAt(eventSiteOf(pair), historyDifferencesOf(pair, events)),
    ),
    ...pairsOf({}, proposed.commands).flatMap((pair) =>
      changesAt(commandSiteOf(pair), historyDifferencesOf(pair, commands)),
    ),
  ];
}

/** The Messages of a package never published: none. */
const noMessages = { events: {}, commands: {} } as const;

/** An Application holds only Dependencies, so it has no Change to judge. */
function changesOf(baseline: PublishedSnapshot, proposed: Snapshot): readonly Change[] {
  if (baseline.kind === 'service' && proposed.kind === 'service') {
    return [
      ...endpointChangesOf(baseline, proposed),
      ...eventChangesOf(baseline, proposed),
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

function siteChangesOf(sites: readonly SiteDifferences[]): readonly Change[] {
  return sites.flatMap(({ site, differences }) => changesAt(site, differences));
}

function endpointChangesOf(
  baseline: PublishedServiceSnapshot,
  proposed: ServiceSnapshot,
): readonly Change[] {
  const defs = bothDefsOf(baseline, proposed);
  const paths = endpointPathsOf(baseline, proposed);
  return pairsOf(baseline.endpoints, proposed.endpoints).flatMap((pair) =>
    endpointPairChangesOf(pair, defs, paths),
  );
}

function endpointPairChangesOf(
  pair: Pair<EndpointSnapshot>,
  defs: BothDefs,
  paths: EndpointPaths,
): readonly Change[] {
  return changesAt(endpointSiteOf(pair), [
    presenceDifferenceOf(pair),
    lifecycleDifferenceOf(pair),
    visibilityDifferenceOf(pair),
    renameDifferenceOf(pair),
    ...shadowingDifferencesOf(pair, paths),
    ...endpointDifferencesOf(pair, defs),
  ]);
}

function eventChangesOf(
  baseline: PublishedServiceSnapshot,
  proposed: ServiceSnapshot,
): readonly Change[] {
  const defs = bothDefsOf(baseline, proposed);
  const history = messageHistoryOf(baseline, proposed, 'event');
  return pairsOf(baseline.events, proposed.events).flatMap((pair) =>
    eventPairChangesOf(pair, defs, history),
  );
}

function eventPairChangesOf(
  pair: Pair<EventSnapshot>,
  defs: BothDefs,
  history: MessageHistory,
): readonly Change[] {
  return changesAt(eventSiteOf(pair), [
    presenceDifferenceOf(pair),
    ...historyDifferencesOf(pair, history),
    lifecycleDifferenceOf(pair),
    visibilityDifferenceOf(pair),
    ...messageBodyDifferencesOf(pair, defs),
  ]);
}

function commandChangesOf(
  baseline: PublishedServiceSnapshot,
  proposed: ServiceSnapshot,
): readonly Change[] {
  const defs = bothDefsOf(baseline, proposed);
  const history = messageHistoryOf(baseline, proposed, 'command');
  return pairsOf(baseline.commands, proposed.commands).flatMap((pair) =>
    changesAt(commandSiteOf(pair), [
      presenceDifferenceOf(pair),
      ...historyDifferencesOf(pair, history),
      lifecycleDifferenceOf(pair),
      ...messageBodyDifferencesOf(pair, defs),
    ]),
  );
}

function eventSiteOf(pair: Pair<EventSnapshot>): ChangeSite {
  return { kind: 'event', identity: pair.identity, visibility: siteVisibilityOf(pair) };
}

/** A Command's site: a Command is always Private. */
function commandSiteOf(pair: Pair<unknown>): ChangeSite {
  return { kind: 'command', identity: pair.identity, visibility: 'private' };
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
