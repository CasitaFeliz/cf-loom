import type { VersionBump } from '@cf-loom/contract/internal';
import {
  bumpedVersionOf,
  compareSemanticVersions,
  isPrerelease,
  nextPrereleaseOf,
  numbersOf,
} from './semantic-versions.ts';

/** The dist-tag a version is published under. */
export type DistTag = 'latest' | 'next';

/** How `publish` was asked to run: publish even when nothing changed, and publish a prerelease of the version it derives. */
export type PublishOptions = { readonly force: boolean; readonly prerelease: boolean };

/** The version `publish` derives and the dist-tag it takes. */
export type DerivedVersion = {
  readonly kind: 'version';
  readonly version: string;
  readonly tag: DistTag;
};

/**
 * The version `publish` derives; the Baseline that already holds what would be published; or a
 * version that would not be above the Baseline, which no publish may take.
 */
export type Derived =
  | DerivedVersion
  | { readonly kind: 'unchanged'; readonly baseline: string }
  | { readonly kind: 'not-above'; readonly version: string; readonly baseline: string };

/** A Baseline's version, the highest version that is not a prerelease, and how far the proposed Snapshot and peer ranges move from the Baseline. */
type Moved = {
  readonly version: string;
  readonly stable: string | undefined;
  readonly bump: VersionBump | 'unchanged';
};

/** What the version is derived from: the Baseline and its bump, every listed version lowest first, and the options. */
export type Deriving = {
  readonly baseline: Moved | undefined;
  readonly versions: readonly string[];
} & PublishOptions;

const firstVersion = '1.0.0';

/**
 * The version a publish takes, as the prerelease `<version>-<n>` when asked, or the Baseline that
 * already holds what it would publish.
 */
export function derivedVersionOf({ baseline, versions, force, prerelease }: Deriving): Derived {
  if (baseline !== undefined && isNothingToPublish(baseline, { force, prerelease })) {
    return { kind: 'unchanged', baseline: baseline.version };
  }
  const next = nextVersionOf(baseline);
  const version = prerelease ? nextPrereleaseOf(next, versions) : next;
  if (baseline !== undefined && compareSemanticVersions(version, baseline.version) <= 0) {
    return { kind: 'not-above', version, baseline: baseline.version };
  }
  const tag = prerelease && baseline?.stable !== undefined ? 'next' : 'latest';
  return { kind: 'version', version, tag };
}

/**
 * The first version that is not a prerelease for a package whose highest version is a prerelease
 * and which lists none that is not: 1.0.0, or that prerelease's numbers when they are higher.
 */
export function firstStableOf(prerelease: string): string {
  return higherOf(firstVersion, numbersOf(prerelease));
}

/** Whether the Baseline already holds what would be published: nothing changed, and no prerelease Baseline left to promote. */
function isNothingToPublish(baseline: Moved, { force, prerelease }: PublishOptions): boolean {
  if (baseline.bump !== 'unchanged' || force) {
    return false;
  }
  return prerelease || !isPrerelease(baseline.version);
}

/** The numbers after the Baseline: 1.0.0 with none, else the higher of the stable version bumped and the Baseline's own numbers. */
function nextVersionOf(baseline: Moved | undefined): string {
  if (baseline === undefined) {
    return firstVersion;
  }
  if (baseline.stable === undefined) {
    return firstStableOf(baseline.version);
  }
  const bump = baseline.bump === 'unchanged' ? 'patch' : baseline.bump;
  return higherOf(numbersOf(baseline.version), bumpedVersionOf(baseline.stable, bump));
}

function higherOf(left: string, right: string): string {
  return compareSemanticVersions(left, right) >= 0 ? left : right;
}
