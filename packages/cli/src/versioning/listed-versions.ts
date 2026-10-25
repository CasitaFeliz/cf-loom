import { isPrerelease } from './semantic-versions.ts';

/** The two versions of a package's list that matter: the Baseline, and the highest one that is not a prerelease. */
export type ListedVersions = {
  readonly baseline: string | undefined;
  readonly stable: string | undefined;
};

/**
 * Which listed version is the Baseline, the highest with prereleases included, and which is the
 * highest one that is not a prerelease, from versions listed lowest first.
 */
export function listedVersionsOf(versions: readonly string[]): ListedVersions {
  return { baseline: versions.at(-1), stable: versions.filter(isStable).at(-1) };
}

function isStable(version: string): boolean {
  return !isPrerelease(version);
}
