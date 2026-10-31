import type {
  EndpointSnapshot,
  EventSnapshot,
  PublishedServiceSnapshot,
  ServiceSnapshot,
  Snapshot,
} from '../snapshot/index.ts';
import { messageBodyDifferencesOf } from './bodies.ts';
import { changesAt } from './changes.ts';
import { endpointDifferencesOf, endpointSiteOf } from './endpoints.ts';
import { type BothDefs, bothDefsOf } from './findings.ts';
import {
  type CheckedService,
  checkedServiceOf,
  formerInputDifferencesOf,
} from './former-inputs.ts';
import { lifecycleDifferenceOf } from './lifecycle.ts';
import { historyDifferencesOf, type MessageHistory, messageHistoryOf } from './message-history.ts';
import { endpointNeutralOf, messageNeutralOf } from './neutral.ts';
import { type Pair, pairsOf } from './pairs.ts';
import { presenceDifferenceOf } from './presence.ts';
import { renameDifferenceOf } from './renames.ts';
import type { Change, ChangeSite } from './report.ts';
import { type EndpointPaths, endpointPathsOf, shadowingDifferencesOf } from './shadowing.ts';
import { siteVisibilityOf, visibilityDifferenceOf } from './visibility.ts';

/** The Messages of a package never published: none. */
const noMessages = { events: {}, commands: {} } as const;

/** The Changes of a Service's Endpoints, by identity in code point order. */
export function endpointChangesOf(
  baseline: PublishedServiceSnapshot,
  proposed: ServiceSnapshot,
): readonly Change[] {
  const checked = checkedServiceOf(baseline, proposed);
  const paths = endpointPathsOf(baseline, proposed);
  return pairsOf(baseline.endpoints, proposed.endpoints).flatMap((pair) =>
    endpointPairChangesOf(pair, checked, paths),
  );
}

/** An Endpoint's Changes against the Baseline, then those against its former Inputs. */
function endpointPairChangesOf(
  pair: Pair<EndpointSnapshot>,
  checked: CheckedService,
  paths: EndpointPaths,
): readonly Change[] {
  const defs = bothDefsOf(checked.baseline, checked.proposed);
  const differences = endpointDifferencesOf(pair, defs);
  return changesAt(endpointSiteOf(pair), [
    presenceDifferenceOf(pair),
    lifecycleDifferenceOf(pair),
    visibilityDifferenceOf(pair),
    renameDifferenceOf(pair),
    ...shadowingDifferencesOf(pair, paths),
    ...differences,
    ...endpointNeutralOf(pair, defs),
    ...formerInputDifferencesOf(pair, checked, differences),
  ]);
}

/** The Changes of a Service's Events, by Message Version in code point order. */
export function eventChangesOf(
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
    ...messageNeutralOf(pair, defs),
  ]);
}

/** The Changes of a Service's Commands, by Message Version in code point order. */
export function commandChangesOf(
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
      ...messageNeutralOf(pair, defs),
    ]),
  );
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

function eventSiteOf(pair: Pair<EventSnapshot>): ChangeSite {
  return { kind: 'event', identity: pair.identity, visibility: siteVisibilityOf(pair) };
}

/** A Command's site: a Command is always Private. */
function commandSiteOf(pair: Pair<unknown>): ChangeSite {
  return { kind: 'command', identity: pair.identity, visibility: 'private' };
}
