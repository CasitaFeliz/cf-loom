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

/** How `publish` was asked to run: publish even when nothing changed, and publish a prerelease of the version it derives. */
export type PublishOptions = { readonly force: boolean; readonly prerelease: boolean };

/** The version `publish` derives and the dist-tag it takes. */
export type DerivedVersion = {
  readonly kind: 'version';
  readonly version: string;
  readonly tag: DistTag;
};

/** The version `publish` derives, or the Baseline that already holds what would be published. */
export type Derived = DerivedVersion | { readonly kind: 'unchanged'; readonly baseline: string };

/** A Baseline's version and how far the proposed Snapshot and peer ranges move from it. */
type Moved = { readonly version: string; readonly bump: VersionBump | 'unchanged' };

/** What the version is derived from: the Baseline and its bump, every listed version lowest first, and the options. */
export type Deriving = {
  readonly baseline: Moved | undefined;
  readonly versions: readonly string[];
} & PublishOptions;

/** The first version that is not a prerelease. */
export const firstVersion = '1.0.0';

/**
 * The version a publish takes, as the prerelease `<version>-<n>` when asked, or the Baseline that
 * already holds what it would publish.
 */
export function derivedVersionOf({ baseline, versions, force, prerelease }: Deriving): Derived {
  const { stable } = listedVersionsOf(versions);
  if (baseline !== undefined && isNothingToPublish(baseline, { force, prerelease })) {
    return { kind: 'unchanged', baseline: baseline.version };
  }
  const next = nextVersionOf(baseline, stable);
  const version = prerelease ? nextPrereleaseOf(next, versions) : next;
  const tag = prerelease && stable !== undefined ? 'next' : 'latest';
  return { kind: 'version', version, tag };
}

/** Whether the Baseline already holds what would be published: nothing changed, and no prerelease Baseline left to promote. */
function isNothingToPublish(baseline: Moved, { force, prerelease }: PublishOptions): boolean {
  if (baseline.bump !== 'unchanged' || force) {
    return false;
  }
  return prerelease || !isPrerelease(baseline.version);
}

/** The numbers after the Baseline: 1.0.0 with none, else the higher of the stable version bumped and the Baseline's own numbers. */
function nextVersionOf(baseline: Moved | undefined, stable: string | undefined): string {
  if (baseline === undefined) {
    return firstVersion;
  }
  const bump = baseline.bump === 'unchanged' ? 'patch' : baseline.bump;
  const bumped = stable === undefined ? firstVersion : bumpedVersionOf(stable, bump);
  const own = numbersOf(baseline.version);
  return compareSemanticVersions(own, bumped) > 0 ? own : bumped;
}
