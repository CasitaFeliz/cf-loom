import type { VersionBump } from '../snapshot/index.ts';
import { type PeerMove, peerBumpOf } from './peers.ts';
import type { Change, ChangeSite, ComparedReport } from './report.ts';

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

/** A Not allowed Change never bumps past patch: `publish` refuses it first. */
function bumpOf({ site, class: changeClass }: Change): VersionBump {
  if (!reachesConsumers(site)) {
    return 'patch';
  }
  switch (changeClass) {
    case 'breaking':
      return 'major';
    case 'additive':
      return 'minor';
    case 'neutral':
    case 'not-allowed':
      return 'patch';
  }
}

/**
 * Whether Consumers can see a site, since the version is a signal for them and for nobody else; a
 * Definitions Package's shared schema or Guard is for the Services that import it, who may use all
 * of it, and a Subscription is the Service's own.
 */
function reachesConsumers(site: ChangeSite): boolean {
  switch (site.kind) {
    case 'endpoint':
    case 'event':
    case 'code':
      return site.visibility !== 'private';
    case 'shared-schema':
    case 'guard':
      return true;
    case 'command':
    case 'subscription':
      return false;
  }
}
