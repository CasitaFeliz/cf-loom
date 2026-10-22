import { bumpedVersionOf, nextPrereleaseOf, type VersionBump } from '@cf-loom/contract/internal';
import type { DistTag } from '../registry/index.ts';

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

/** What the version is derived from: the Baseline and its bump, every listed version, and the options. */
export type Deriving = {
  readonly baseline: Moved | undefined;
  readonly versions: readonly string[];
} & PublishOptions;

/**
 * The version a publish takes: the Baseline bumped, or 1.0.0 with none, as the prerelease
 * `<version>-<n>` when asked; a package with a Baseline and no change takes none unless forced.
 */
export function derivedVersionOf({ baseline, versions, force, prerelease }: Deriving): Derived {
  if (baseline?.bump === 'unchanged' && !force) {
    return { kind: 'unchanged', baseline: baseline.version };
  }
  const next = nextVersionOf(baseline);
  const version = prerelease ? nextPrereleaseOf(next, versions) : next;
  const tag = prerelease && baseline !== undefined ? 'next' : 'latest';
  return { kind: 'version', version, tag };
}

/** The version after the Baseline: 1.0.0 with none, else the Baseline bumped, by a patch when nothing moved. */
function nextVersionOf(baseline: Moved | undefined): string {
  if (baseline === undefined) {
    return '1.0.0';
  }
  const bump = baseline.bump === 'unchanged' ? 'patch' : baseline.bump;
  return bumpedVersionOf(baseline.version, bump);
}
