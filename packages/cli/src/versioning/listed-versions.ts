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

function isStable(version: string): boolean {
  return !isPrerelease(version);
}
