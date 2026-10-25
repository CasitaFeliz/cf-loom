import {
  definitionsPackageOf,
  type ResolvedDefinitions,
  standardRejectionsSourceOf,
} from '@cf-loom/contract/internal';
import { definitionsPackagesOf, unversionedDefinitionsOf } from './definitions-packages.ts';
import type { ImportedPackage } from './imported-packages.ts';

/** The Definitions Packages the root's import reached, or why the Contract cannot use them. */
export type ResolvedPackages =
  | { readonly kind: 'resolved'; readonly packages: readonly ResolvedDefinitions[] }
  | { readonly kind: 'failed'; readonly message: string };

/**
 * The Definitions Packages the root's import reached, each at its exact version; the one a
 * Contract names as `standardRejections` must be one of them, and exactly one.
 */
export function resolvePackages(
  root: unknown,
  imported: readonly ImportedPackage[],
): ResolvedPackages {
  const [unversioned] = unversionedDefinitionsOf(imported);
  if (unversioned !== undefined) {
    return failed(`${unversioned.packageName} has no version in its package.json`);
  }
  const packages = definitionsPackagesOf(imported);
  const named = standardRejectionsSourceOf(root);
  if (named === undefined) {
    return { kind: 'resolved', packages };
  }
  const provenance = definitionsPackageOf(packages, named);
  switch (provenance.kind) {
    case 'found':
      return { kind: 'resolved', packages };
    case 'none': {
      const none = "standardRejections is exported by no package the Contract's files import";
      return failed(`${none}: name the definitions a Definitions Package exports`);
    }
    case 'ambiguous': {
      const [first, second] = provenance.packages;
      const both = `exported by both ${first.packageName} and ${second.packageName}`;
      const neither = 'and neither imports it from the other: import it from one package';
      return failed(`standardRejections is ${both}, ${neither}`);
    }
  }
}

function failed(message: string): ResolvedPackages {
  return { kind: 'failed', message };
}
