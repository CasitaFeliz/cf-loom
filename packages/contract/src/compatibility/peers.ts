import { caretLineOf, isSemanticVersion } from '../snapshot/index.ts';

/** A package's peer ranges, as its package.json's `peerDependencies` holds them. */
export type PeerRanges = Readonly<Record<string, string>>;

/** The peer ranges of the Baseline's package and of the package about to be published. */
export type PeerMove = { readonly baseline: PeerRanges; readonly proposed: PeerRanges };

/**
 * How far the peer ranges moving from the Baseline's to the proposed ones bump the version: major
 * when a peer moves to a new major, minor for any other change to a range, else `unchanged`.
 */
export function peerBumpOf({ baseline, proposed }: PeerMove): 'major' | 'minor' | 'unchanged' {
  const before = new Map(Object.entries(baseline));
  const after = new Map(Object.entries(proposed));
  const names = new Set([...before.keys(), ...after.keys()]);
  const bumps = [...names].map((name) => rangeBumpOf(before.get(name), after.get(name)));
  if (bumps.includes('major')) {
    return 'major';
  }
  return bumps.includes('minor') ? 'minor' : 'unchanged';
}

function rangeBumpOf(
  before: string | undefined,
  after: string | undefined,
): 'major' | 'minor' | 'unchanged' {
  if (before === after) {
    return 'unchanged';
  }
  if (before === undefined || after === undefined) {
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
