import {
  follows,
  kebabCase,
  listedDefinitionsOf,
  type ResolvedDefinitions,
} from '@cf-loom/contract/internal';
import { installedPackageOf, type LookedUp } from './installed-package.ts';

/** A listed Definitions Package as installed, with what its module exports, by name. */
export type InstalledDefinitions = ResolvedDefinitions & {
  readonly exports: Readonly<Record<string, unknown>>;
};

/** The Definitions Packages a root lists as installed, or the first that is not. */
export type ResolvedPackages =
  | { readonly kind: 'resolved'; readonly packages: readonly InstalledDefinitions[] }
  | { readonly kind: 'failed'; readonly message: string };

/** What a listed Definitions Package is resolved from: where it is looked up and the scope. */
export type Resolving = LookedUp & { readonly scope: string };

/**
 * Resolves each Definitions Package a root lists to the package `<scope>/<name>` as the root
 * file imports it, at its exact version, with what its module exports; a name that breaks the
 * grammar names no package and is left to the validation.
 */
export async function resolvePackages(
  root: unknown,
  resolving: Resolving,
): Promise<ResolvedPackages> {
  const packages: InstalledDefinitions[] = [];
  const named = listedDefinitionsOf(root).filter(({ name }) => follows(kebabCase, name));
  for (const definitions of named) {
    const packageName = `${resolving.scope}/${definitions.name}`;
    const installed = await installedPackageOf(packageName, resolving);
    if (installed.kind === 'failed') {
      return installed;
    }
    const { version, exports } = installed;
    packages.push({ definitions, packageName, version, exports });
  }
  return { kind: 'resolved', packages };
}
