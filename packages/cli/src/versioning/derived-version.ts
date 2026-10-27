import type { VersionBump } from '@cf-loom/contract/internal';
import { listedVersionsOf } from './listed-versions.ts';
import {
  bumpedVersionOf,
  compareSemanticVersions,
  isPrerelease,
  nextPrereleaseOf,
  numbersOf,
} from './semantic-versions.ts';

/** The dist-tag a version is published under. */
export type DistTag = 'latest' | 'next';

/** How the version is asked to be derived: even when nothing changed, and as a prerelease of the version it derives. */
export type DeriveOptions = { readonly force: boolean; readonly prerelease: boolean };

/**
 * Why a version is derived: the package has no Baseline, the size of what moved, a prerelease
 * Baseline promoted to the version that is not one, `--force` over a Baseline nothing moved
 * from, or a listed version cf-loom did not publish that the version must be a major above.
 */
export type Why =
  | { readonly kind: 'first-version' }
  | { readonly kind: 'bump'; readonly bump: VersionBump }
  | { readonly kind: 'promotes'; readonly baseline: string }
  | { readonly kind: 'forced' }
  | { readonly kind: 'above-unchecked'; readonly version: string };

/** The version `publish` derives, the dist-tag it takes and why. */
export type DerivedVersion = {
  readonly kind: 'version';
  readonly version: string;
  readonly tag: DistTag;
  readonly why: Why;
};

/**
 * The version `publish` derives; the Baseline that already holds what would be published; or a
 * version that would not be above the Baseline, which no publish may take.
 */
export type Derived =
  | DerivedVersion
  | { readonly kind: 'unchanged'; readonly baseline: string }
  | { readonly kind: 'not-above'; readonly version: string; readonly baseline: string };

/** A Baseline's version and how far the proposed Snapshot and peer ranges move from it. */
type Moved = { readonly version: string; readonly bump: VersionBump | 'unchanged' };

/**
 * What the version is derived from: the Baseline `baselineOf` chose and its bump, none when the
 * package has none, every listed version lowest first, and the options.
 */
export type Deriving = {
  readonly baseline: Moved | undefined;
  readonly versions: readonly string[];
} & DeriveOptions;

const firstVersion = '1.0.0';

/**
 * The version a publish takes, as the prerelease `<version>-<n>` when asked: the higher of what
 * the Baseline gives and the next major above the highest listed version that is not a prerelease
 * and is not the Baseline, which cf-loom did not publish; or the Baseline that already holds what
 * it would publish; or a version that would not be above the Baseline, which no publish may take.
 */
export function derivedVersionOf({ baseline, versions, force, prerelease }: Deriving): Derived {
  if (baseline !== undefined && isNothingToPublish(baseline, { force, prerelease })) {
    return { kind: 'unchanged', baseline: baseline.version };
  }
  const { numbers, above } = numbersAfter(baseline, uncheckedOf(baseline, versions));
  const version = prerelease ? nextPrereleaseOf(numbers, versions) : numbers;
  if (baseline !== undefined && compareSemanticVersions(version, baseline.version) <= 0) {
    return { kind: 'not-above', version, baseline: baseline.version };
  }
  const tag = tagOf(baseline, prerelease);
  return { kind: 'version', version, tag, why: whyOf(baseline, above, prerelease) };
}

/** `latest` for the version that becomes the Baseline: a prerelease only while cf-loom published no version that is not one; else `next`. */
function tagOf(baseline: Moved | undefined, prerelease: boolean): DistTag {
  const hasPublishedStable = baseline !== undefined && !isPrerelease(baseline.version);
  return prerelease && hasPublishedStable ? 'next' : 'latest';
}

/** Why the version is the one derived: the first, a major above a version cf-loom did not publish, what moved, a promotion, or `--force`. */
function whyOf(baseline: Moved | undefined, above: string | undefined, prerelease: boolean): Why {
  if (baseline === undefined) {
    return { kind: 'first-version' };
  }
  if (above !== undefined) {
    return { kind: 'above-unchecked', version: above };
  }
  if (baseline.bump !== 'unchanged') {
    return { kind: 'bump', bump: baseline.bump };
  }
  return isPrerelease(baseline.version) && !prerelease
    ? { kind: 'promotes', baseline: baseline.version }
    : { kind: 'forced' };
}

/**
 * The first version that is not a prerelease over a prerelease Baseline: 1.0.0, or the next
 * major above the highest listed version that is not a prerelease, or the Baseline's numbers
 * when higher.
 */
export function firstStableOf(prerelease: string, stable: string | undefined): string {
  return numbersAfter({ version: prerelease, bump: 'unchanged' }, stable).numbers;
}

/** Whether the Baseline already holds what would be published: nothing changed, and no prerelease Baseline left to promote. */
function isNothingToPublish(baseline: Moved, { force, prerelease }: DeriveOptions): boolean {
  if (baseline.bump !== 'unchanged' || force) {
    return false;
  }
  return prerelease || !isPrerelease(baseline.version);
}

/** The highest listed version that is not a prerelease, when it is not the Baseline: cf-loom did not publish it, or the Baseline would be it. */
function uncheckedOf(baseline: Moved | undefined, versions: readonly string[]): string | undefined {
  const { stable } = listedVersionsOf(versions);
  return stable === baseline?.version ? undefined : stable;
}

/** The numbers after the Baseline, and the unchecked version they had to rise above when it is higher than what the Baseline gives. */
function numbersAfter(
  baseline: Moved | undefined,
  unchecked: string | undefined,
): { readonly numbers: string; readonly above: string | undefined } {
  const given = givenBy(baseline);
  if (unchecked === undefined) {
    return { numbers: given, above: undefined };
  }
  const floor = bumpedVersionOf(unchecked, 'major');
  return compareSemanticVersions(floor, given) > 0
    ? { numbers: floor, above: unchecked }
    : { numbers: given, above: undefined };
}

/** What the Baseline gives: 1.0.0 with none, the Baseline bumped when it is not a prerelease, else 1.0.0 or the prerelease's own numbers when higher. */
function givenBy(baseline: Moved | undefined): string {
  if (baseline === undefined) {
    return firstVersion;
  }
  if (isPrerelease(baseline.version)) {
    return higherOf(firstVersion, numbersOf(baseline.version));
  }
  return bumpedVersionOf(baseline.version, baseline.bump === 'unchanged' ? 'patch' : baseline.bump);
}

function higherOf(left: string, right: string): string {
  return compareSemanticVersions(left, right) >= 0 ? left : right;
}
