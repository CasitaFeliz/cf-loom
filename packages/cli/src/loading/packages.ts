import {
  definitionsPackageOf,
  type ImportedContractPackage,
  type ImportedDefinitions,
  identityLineOf,
  packageLabelOf,
  standardRejectionsSourceOf,
} from '@cf-loom/contract/internal';
import { contractPackagesOf } from './contract-packages.ts';
import { definitionsPackagesOf } from './definitions-packages.ts';
import type { ImportedPackage } from './imported-packages.ts';

/** The Definitions Packages and the Contract Packages the Root's import reached, or why the Contract cannot take its Standard Rejections. */
export type ResolvedPackages =
  | {
      readonly kind: 'resolved';
      readonly packages: readonly ImportedDefinitions[];
      readonly contractPackages: readonly ImportedContractPackage[];
    }
  | { readonly kind: 'failed'; readonly message: string };

/**
 * The Definitions Packages and the Contract Packages the Root's import reached, as their
 * package.json names them or not; the one a Contract names as `standardRejections` must belong to
 * exactly one of the Definitions Packages, with a name and a version.
 */
export function resolvePackages(
  root: unknown,
  imported: readonly ImportedPackage[],
): ResolvedPackages {
  const packages = definitionsPackagesOf(imported);
  const contractPackages = contractPackagesOf(imported);
  const named = standardRejectionsSourceOf(root);
  if (named === undefined) {
    return { kind: 'resolved', packages, contractPackages };
  }
  const provenance = definitionsPackageOf(packages, named);
  switch (provenance.kind) {
    case 'found':
      return { kind: 'resolved', packages, contractPackages };
    case 'unidentified':
      return failed(identityLineOf(provenance.package));
    case 'none': {
      const none = "standardRejections is exported by no package the Contract's files import";
      return failed(`${none}: name the definitions a Definitions Package exports`);
    }
    case 'ambiguous': {
      const [first, second] = provenance.packages.map(packageLabelOf);
      const both = `exported by both ${first} and ${second}`;
      const neither = 'and neither imports it from the other: import it from one package';
      return failed(`standardRejections is ${both}, ${neither}`);
    }
  }
}

function failed(message: string): ResolvedPackages {
  return { kind: 'failed', message };
}
