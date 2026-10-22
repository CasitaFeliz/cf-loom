import type { VersionBump } from '@cf-loom/contract/internal';
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

/** The three numbers of a release, which a Baseline always is. */
const releaseCore = /^(\d+)\.(\d+)\.(\d+)/;

/**
 * The version a publish takes: the Baseline bumped, or 1.0.0 with none, as the prerelease
 * `<version>-<n>` when asked; a package with a Baseline and no change takes none unless forced.
 */
export function derivedVersionOf({ baseline, versions, force, prerelease }: Deriving): Derived {
  if (baseline?.bump === 'unchanged' && !force) {
    return { kind: 'unchanged', baseline: baseline.version };
  }
  const release = releaseOf(baseline);
  const version = prerelease ? `${release}-${nextPrereleaseOf(release, versions)}` : release;
  const tag = prerelease && baseline !== undefined ? 'next' : 'latest';
  return { kind: 'version', version, tag };
}

/** The release a publish is of: 1.0.0 with no Baseline, else the Baseline bumped, by a patch when nothing moved. */
function releaseOf(baseline: Moved | undefined): string {
  if (baseline === undefined) {
    return '1.0.0';
  }
  return bumpedBy(baseline.version, baseline.bump === 'unchanged' ? 'patch' : baseline.bump);
}

function bumpedBy(version: string, bump: VersionBump): string {
  const [, major = '0', minor = '0', patch = '0'] = releaseCore.exec(version) ?? [];
  switch (bump) {
    case 'major':
      return `${BigInt(major) + 1n}.0.0`;
    case 'minor':
      return `${major}.${BigInt(minor) + 1n}.0`;
    case 'patch':
      return `${major}.${minor}.${BigInt(patch) + 1n}`;
  }
}

/** One above the highest `<release>-<n>` the package lists, else 0. */
function nextPrereleaseOf(release: string, versions: readonly string[]): bigint {
  let next = 0n;
  for (const version of versions) {
    const counter = counterOf(release, version);
    if (counter !== undefined && counter >= next) {
      next = counter + 1n;
    }
  }
  return next;
}

/** The `<n>` of a version that is `<release>-<n>`, with no leading zero. */
function counterOf(release: string, version: string): bigint | undefined {
  const rest = version.startsWith(`${release}-`) ? version.slice(release.length + 1) : '';
  return /^(0|[1-9]\d*)$/.test(rest) ? BigInt(rest) : undefined;
}
