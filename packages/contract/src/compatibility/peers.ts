import { caretLineOf, isSemanticVersion } from '../snapshot/index.ts';
import { byCodePoint } from '../walker/index.ts';

/** A package's peer ranges, as its package.json's `peerDependencies` holds them. */
export type PeerRanges = Readonly<Record<string, string>>;

/** The peer ranges of the Baseline's package and of the package about to be published. */
export type PeerMove = { readonly baseline: PeerRanges; readonly proposed: PeerRanges };

/** One peer range that moved from the Baseline's to the proposed package's, with the bump the peer rule gives it. */
export type PeerRangeMove = {
  readonly name: string;
  /** The Baseline's range, `null` when the peer is added. */
  readonly from: string | null;
  /** The proposed range, `null` when the peer is dropped. */
  readonly to: string | null;
  readonly bump: 'major' | 'minor';
};

/** Every peer range that moved, by name in code point order; equal ranges move nothing. */
export function peerMovesOf({ baseline, proposed }: PeerMove): readonly PeerRangeMove[] {
  const before = new Map(Object.entries(baseline));
  const after = new Map(Object.entries(proposed));
  const names = [...new Set([...before.keys(), ...after.keys()])].sort(byCodePoint);
  const moves: PeerRangeMove[] = [];
  for (const name of names) {
    const from = before.get(name) ?? null;
    const to = after.get(name) ?? null;
    const bump = rangeBumpOf(from, to);
    if (bump !== 'unchanged') {
      moves.push({ name, from, to, bump });
    }
  }
  return moves;
}

/**
 * How far the peer ranges moving from the Baseline's to the proposed ones bump the version: major
 * when a peer moves to a new major, minor for any other change to a range, else `unchanged`.
 */
export function peerBumpOf(peers: PeerMove): 'major' | 'minor' | 'unchanged' {
  const bumps = peerMovesOf(peers).map(({ bump }) => bump);
  if (bumps.includes('major')) {
    return 'major';
  }
  return bumps.includes('minor') ? 'minor' : 'unchanged';
}

function rangeBumpOf(before: string | null, after: string | null): 'major' | 'minor' | 'unchanged' {
  if (before === after) {
    return 'unchanged';
  }
  if (before === null || after === null) {
    return 'minor';
  }
  return isNewMajor(caretLineIn(before), caretLineIn(after)) ? 'major' : 'minor';
}

/** A range that is no caret on a semantic version has no line, so no overlap with it can be proven. */
function isNewMajor(before: string | undefined, after: string | undefined): boolean {
  return before === undefined || after === undefined || before !== after;
}

function caretLineIn(range: string): string | undefined {
  const version = range.startsWith('^') ? range.slice(1) : '';
  return isSemanticVersion(version) ? caretLineOf(version) : undefined;
}
