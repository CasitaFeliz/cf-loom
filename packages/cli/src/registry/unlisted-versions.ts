import { byCodePoint, type OriginPackage } from '@cf-loom/contract/internal';
import type { Failed } from '../child-process/index.ts';
import type { NpmPlace } from './npm.ts';
import { versionsOf } from './package-versions.ts';

/** A Provider a Contract uses, the package its Contract Package is and the version the Contract is against. */
export type DependencyVersion = {
  readonly provider: string;
  readonly packageName: string;
  readonly version: string;
};

/** The versions of other packages a Contract is declared against: its Providers' and the Definitions Packages its origins name. */
export type UsedVersions = {
  readonly dependencies: readonly DependencyVersion[];
  readonly origins: readonly OriginPackage[];
};

/** The lines naming each used version that the registry does not list, none when it lists them all. */
export type UnlistedVersions =
  | { readonly kind: 'unlisted'; readonly lines: readonly string[] }
  | Failed;

/**
 * Reads, through the organization's npm, what the registry lists of each package a Contract is
 * declared against, and says in one line each version it does not list, a package it does not
 * know included.
 */
export async function unlistedVersionLinesOf(
  npm: NpmPlace,
  used: UsedVersions,
): Promise<UnlistedVersions> {
  const names = [...used.dependencies, ...used.origins].map(({ packageName }) => packageName);
  const listed = new Map<string, ReadonlySet<string>>();
  for (const packageName of [...new Set(names)].sort(byCodePoint)) {
    const found = await versionsOf(npm, packageName);
    switch (found.kind) {
      case 'failed':
        return found;
      case 'not-found':
        listed.set(packageName, new Set());
        break;
      case 'versions':
        listed.set(packageName, new Set(found.listing.versions));
        break;
    }
  }
  const isUnlisted = ({ packageName, version }: OriginPackage) =>
    listed.get(packageName)?.has(version) !== true;
  const dependencies = used.dependencies.filter(isUnlisted).map(dependencyLineOf);
  const origins = used.origins.filter(isUnlisted).map(originLineOf);
  return { kind: 'unlisted', lines: [...dependencies, ...origins] };
}

function dependencyLineOf({ provider, packageName, version }: DependencyVersion): string {
  const against = `is against ${packageName}@${version}, which the registry does not list`;
  return `dependencies.${provider} ${against}: install a published version`;
}

function originLineOf({ packageName, version }: OriginPackage): string {
  const used = `${packageName}@${version}, which the Contract uses, is not listed by the registry`;
  return `${used}: install a published version`;
}
