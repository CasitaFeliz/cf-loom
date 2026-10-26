import {
  type PeerRangeMove,
  type PeerRanges,
  peerMovesOf,
  type VersionBump,
  versionBumpOf,
} from '@cf-loom/contract/internal';
import { type Derived, type DeriveOptions, derivedVersionOf } from '../versioning/index.ts';
import type { Checked } from './checked.ts';
import { type Comparison, checkedFrom } from './comparison.ts';
import type { Prepared } from './prepared.ts';

/**
 * What `check` and `publish` derive from a comparison: every peer range that moved, the bump the
 * Changes and the peers give, `null` when nothing moved, and the version it leads to.
 */
export type Derivation = {
  readonly peers: readonly PeerRangeMove[];
  readonly bump: VersionBump | null;
  readonly derived: Derived;
};

/**
 * What `check` reports of a prepared comparison, with the version `publish` derives from it,
 * unless `--against` named the version compared with, or a Change is refused: neither is what
 * `publish` would do.
 */
export function derivedCheckedOf(prepared: Prepared, options: DeriveOptions): Checked {
  const { comparison, peerRanges } = prepared;
  const checked = checkedFrom(comparison);
  const derives = isPublishable(comparison) && checked.changes.every(isNotRefused);
  return derives
    ? { ...checked, derivation: derivationOf(comparison, peerRanges, options) }
    : checked;
}

function isPublishable(comparison: Comparison): boolean {
  return comparison.kind === 'no-baseline' || comparison.read.chosen !== 'against';
}

function isNotRefused({ verdict }: Checked['changes'][number]): boolean {
  return verdict !== 'refused';
}

function derivationOf(
  comparison: Comparison,
  proposed: PeerRanges,
  options: DeriveOptions,
): Derivation {
  switch (comparison.kind) {
    case 'no-baseline': {
      const derived = derivedVersionOf({ baseline: undefined, versions: [], ...options });
      return { peers: [], bump: null, derived };
    }
    case 'baseline': {
      const { read, report } = comparison;
      const moves = { baseline: read.peers, proposed };
      const bump = versionBumpOf(report, moves);
      const baseline = { version: read.snapshot.version, stable: read.stable, bump };
      const derived = derivedVersionOf({ baseline, versions: read.versions, ...options });
      return { peers: peerMovesOf(moves), bump: bump === 'unchanged' ? null : bump, derived };
    }
  }
}
