import {
  type PeerRangeMove,
  type PeerRanges,
  peerMovesOf,
  type VersionBump,
  versionBumpOf,
} from '@cf-loom/contract/internal';
import {
  type Derived,
  type DeriveOptions,
  type Deriving,
  derivedVersionOf,
} from '../versioning/index.ts';
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
  const { compared, listing } = comparison;
  const deriving = { versions: listing.versions, ...options };
  if (compared.kind === 'no-baseline') {
    const derived = derivedVersionOf({ baseline: undefined, ...deriving });
    return { kind: 'derived', peers: [], bump: null, derived };
  }
  return compared.baseline.chosen === 'against'
    ? { kind: 'against' }
    : derivedAgainst(compared, peerRanges, deriving);
}

function derivedAgainst(
  { baseline, report }: Extract<Comparison['compared'], { kind: 'baseline' }>,
  proposed: PeerRanges,
  deriving: Omit<Deriving, 'baseline'>,
): Derivation {
  const moves = { baseline: baseline.peers, proposed };
  const bump = versionBumpOf(report, moves);
  const moved = { version: baseline.snapshot.version, bump };
  const derived = derivedVersionOf({ baseline: moved, ...deriving });
  const peers = peerMovesOf(moves);
  return { kind: 'derived', peers, bump: bump === 'unchanged' ? null : bump, derived };
}
