import { isPrerelease } from './semantic-versions.ts';

/** The two versions of a package's list that matter: the highest, a prerelease included, and the highest one that is not a prerelease. */
export type ListedVersions = {
  readonly highest: string | undefined;
  readonly stable: string | undefined;
};

/** The highest listed version and the highest one that is not a prerelease, from versions listed lowest first. */
export function listedVersionsOf(versions: readonly string[]): ListedVersions {
  return { highest: versions.at(-1), stable: versions.filter(isStable).at(-1) };
}

/**
 * The versions a Baseline is chosen among, in the order they are tried: those that are not
 * prereleases, highest first, then the prereleases, highest first. The first that carries
 * `cfLoom` is the Baseline. Versions must be listed lowest first.
 */
export function baselineCandidatesOf(versions: readonly string[]): readonly string[] {
  const stable = versions.filter(isStable).reverse();
  const prereleases = versions.filter(isPrerelease).reverse();
  return [...stable, ...prereleases];
}

function isStable(version: string): boolean {
  return !isPrerelease(version);
}
