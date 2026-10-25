import type { VersionBump } from '../snapshot/index.ts';
import { type PeerMove, peerBumpOf } from './peers.ts';
import type { Change, ComparedReport } from './report.ts';

const bumpsInOrder = ['unchanged', 'patch', 'minor', 'major'] as const;

/**
 * The bump a publish takes: the highest of its Changes' classes, Private ones capped at patch, and
 * of the peer rule; `unchanged` when neither the hash nor a peer range moved.
 */
export function versionBumpOf(report: ComparedReport, peers: PeerMove): VersionBump | 'unchanged' {
  const snapshotBump = report.hashChanged ? snapshotBumpOf(report.changes) : 'unchanged';
  return higherOf(snapshotBump, peerBumpOf(peers));
}

/** A changed hash is a patch at least, whatever its Changes; the highest of them decides past that. */
function snapshotBumpOf(changes: readonly Change[]): VersionBump {
  let highest: VersionBump = 'patch';
  for (const change of changes) {
    highest = higherOf(highest, bumpOf(change));
  }
  return highest;
}

function higherOf<Bump extends (typeof bumpsInOrder)[number]>(left: Bump, right: Bump): Bump {
  return bumpsInOrder.indexOf(left) >= bumpsInOrder.indexOf(right) ? left : right;
}

/**
 * A refused Change never bumps past patch, since `publish` refuses it first; nor does one on a
 * Private site, which no Consumer reads.
 */
function bumpOf({ site, class: changeClass, verdict }: Change): VersionBump {
  if (verdict === 'refused' || site.visibility === 'private') {
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
