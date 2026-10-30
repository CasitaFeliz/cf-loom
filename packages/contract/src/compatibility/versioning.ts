import type { VersionBump } from '../snapshot/index.ts';
import { type PeerMove, peerBumpOf } from './peers.ts';
import type { Change, ComparedReport } from './report.ts';

const bumpsInOrder = ['unchanged', 'patch', 'minor', 'major'] as const;

/**
 * The bump a publish takes: the highest of its Changes' classes, Private ones capped at patch, and
 * of the peer rule; `unchanged` with no Change and no peer range moved.
 */
export function versionBumpOf(report: ComparedReport, peers: PeerMove): VersionBump | 'unchanged' {
  return higherOf(changesBumpOf(report.changes), peerBumpOf(peers));
}

/** The highest bump of the Changes, `unchanged` when there are none. */
function changesBumpOf(changes: readonly Change[]): VersionBump | 'unchanged' {
  let highest: VersionBump | 'unchanged' = 'unchanged';
  for (const change of changes) {
    highest = higherOf(highest, bumpOf(change));
  }
  return highest;
}

function higherOf<Bump extends (typeof bumpsInOrder)[number]>(left: Bump, right: Bump): Bump {
  return bumpsInOrder.indexOf(left) >= bumpsInOrder.indexOf(right) ? left : right;
}

/** A Change on a Private site never bumps past patch: no Consumer reads it. */
function bumpOf({ site, class: changeClass }: Change): VersionBump {
  if (site.visibility === 'private') {
    return 'patch';
  }
  switch (changeClass) {
    case 'breaking':
      return 'major';
    case 'additive':
      return 'minor';
    case 'neutral':
      return 'patch';
  }
}
