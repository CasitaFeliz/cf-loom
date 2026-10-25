import { definitionsPackageOf, standardRejectionsSourceOf } from '@cf-loom/contract/internal';
import { type DefinitionsPackages, definitionsPackagesOf } from './definitions-packages.ts';
import type { ImportedPackage } from './imported-packages.ts';

/** The Definitions Packages the root's import reached, or why the Contract cannot take its Standard Rejections. */
export type ResolvedPackages =
  | ({ readonly kind: 'resolved' } & DefinitionsPackages)
  | { readonly kind: 'failed'; readonly message: string };

/**
 * The Definitions Packages the root's import reached, each at its exact version; the one a
 * Contract names as `standardRejections` must be exactly one of them, with a name and a version.
 */
export function resolvePackages(
  root: unknown,
  imported: readonly ImportedPackage[],
): ResolvedPackages {
  const found = definitionsPackagesOf(imported);
  const named = standardRejectionsSourceOf(root);
  if (named === undefined) {
    return { kind: 'resolved', ...found };
  }
  const provenance = definitionsPackageOf(found.packages, named);
  switch (provenance.kind) {
    case 'found':
      return { kind: 'resolved', ...found };
    case 'none': {
      const exporter = found.unidentified.find(({ exports }) =>
        Object.values(exports).includes(named),
      );
      if (exporter !== undefined) {
        return failed(exporter.why);
      }
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
