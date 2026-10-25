import type { ByKey, PublishedServiceSnapshot, ServiceSnapshot } from '../snapshot/index.ts';
import { messageIdentityOf, nameAndVersionOf } from '../written/index.ts';
import type { Pair } from './pairs.ts';
import type { Difference } from './report.ts';

type MessageKind = 'event' | 'command';

type Messages = { readonly events: ByKey<unknown>; readonly commands: ByKey<unknown> };

/** What a Message Version added is judged against: its kind's identities on either side, and the names the Baseline holds as the other kind. */
export type MessageHistory = {
  readonly identities: ReadonlySet<string>;
  readonly otherKind: MessageKind;
  readonly otherNames: ReadonlySet<string>;
};

/**
 * One kind of Message's history across the Baseline, tombstones included, and the proposed
 * Snapshot; with no Baseline, the proposed Snapshot is the whole history.
 */
export function messageHistoryOf(
  baseline: PublishedServiceSnapshot | undefined,
  proposed: ServiceSnapshot,
  kind: MessageKind,
): MessageHistory {
  const before: Messages = baseline ?? { events: {}, commands: {} };
  const otherKind = kind === 'event' ? 'command' : 'event';
  const identities = [...identitiesOf(before, kind), ...identitiesOf(proposed, kind)];
  const otherNames = identitiesOf(before, otherKind).map((identity) => {
    return nameAndVersionOf(identity).name;
  });
  return { identities: new Set(identities), otherKind, otherNames: new Set(otherNames) };
}

/** A Message Version added under the other kind's name, or after a version neither side holds; what the Baseline holds is not judged again. */
export function historyDifferencesOf(
  pair: Pair<unknown>,
  history: MessageHistory,
): readonly Difference[] {
  if (pair.kind !== 'added') {
    return [];
  }
  const { name, version } = nameAndVersionOf(pair.identity);
  if (history.otherNames.has(name)) {
    return [{ kind: 'name-kind-changed', from: history.otherKind }];
  }
  const previous = messageIdentityOf(name, version - 1);
  return version > 1 && !history.identities.has(previous)
    ? [{ kind: 'version-gap', missing: previous }]
    : [];
}

function identitiesOf(snapshot: Messages, kind: MessageKind): readonly string[] {
  switch (kind) {
    case 'event':
      return Object.keys(snapshot.events);
    case 'command':
      return Object.keys(snapshot.commands);
  }
}
