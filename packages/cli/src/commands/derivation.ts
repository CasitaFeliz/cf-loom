import {
  type PeerRangeMove,
  type PeerRanges,
  peerMovesOf,
  type VersionBump,
  versionBumpOf,
} from '@cf-loom/contract/internal';
import { type Derived, type DeriveOptions, derivedVersionOf } from '../versioning/index.ts';
import type { Checked, Compared } from './checked.ts';
import { type Comparison, comparedFrom } from './comparison.ts';
import type { Prepared } from './prepared.ts';

/**
 * What `check` and `publish` derive from a comparison: the version, with every peer range that
 * moved and the bump the Changes and the peers give, `null` when nothing moved; that a Change is
 * refused, which no version follows; or that `--against` named the version compared with, which is
 * not what `publish` would do.
 */
export type Derivation =
  | {
      readonly kind: 'derived';
      readonly peers: readonly PeerRangeMove[];
      readonly bump: VersionBump | null;
      readonly derived: Derived;
    }
  | { readonly kind: 'refused' }
  | { readonly kind: 'against' };

/** What `check` reports of a prepared comparison, with the version `publish` derives from it. */
export function derivedCheckedOf(prepared: Prepared, options: DeriveOptions): Checked {
  const compared = comparedFrom(prepared.comparison);
  return { ...compared, derivation: derivationOf(prepared, compared, options) };
}

function derivationOf(
  { comparison, peerRanges }: Prepared,
  { changes }: Compared,
  options: DeriveOptions,
): Derivation {
  if (changes.some(({ verdict }) => verdict === 'refused')) {
    return { kind: 'refused' };
  }
  if (comparison.kind === 'no-baseline') {
    const derived = derivedVersionOf({ baseline: undefined, versions: [], ...options });
    return { kind: 'derived', peers: [], bump: null, derived };
  }
  return comparison.read.chosen === 'against'
    ? { kind: 'against' }
    : derivedAgainst(comparison, peerRanges, options);
}

function derivedAgainst(
  { read, report }: Extract<Comparison, { kind: 'baseline' }>,
  proposed: PeerRanges,
  options: DeriveOptions,
): Derivation {
  const moves = { baseline: read.peers, proposed };
  const bump = versionBumpOf(report, moves);
  const baseline = { version: read.snapshot.version, stable: read.stable, bump };
  const derived = derivedVersionOf({ baseline, versions: read.versions, ...options });
  const peers = peerMovesOf(moves);
  return { kind: 'derived', peers, bump: bump === 'unchanged' ? null : bump, derived };
}
