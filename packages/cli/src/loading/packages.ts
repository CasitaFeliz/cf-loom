import { listedDefinitionsOf, type ResolvedDefinitions } from '@cf-loom/contract/internal';
import { type ImportedPackage, packagesExporting } from './imported-packages.ts';

/** The Definitions Packages a root lists as installed, or the first that is not one package. */
export type ResolvedPackages =
  | { readonly kind: 'resolved'; readonly packages: readonly ResolvedDefinitions[] }
  | { readonly kind: 'failed'; readonly message: string };

/**
 * Resolves each Definitions object a root lists to the one imported package that exports it, by
 * identity, at its exact version, with what its module exports.
 */
export function resolvePackages(
  root: unknown,
  imported: readonly ImportedPackage[],
): ResolvedPackages {
  const packages: ResolvedDefinitions[] = [];
  for (const { at, definitions } of listedDefinitionsOf(root)) {
    const listed = `${String(at[0])}[${String(at[1])}]`;
    const exporting = packagesExporting(imported, definitions);
    const [found, ...others] = exporting;
    if (found === undefined) {
      const none = "is exported by no package the Contract's files import";
      return failed(`${listed} ${none}: list the definitions a Definitions Package exports`);
    }
    if (others.length > 0) {
      const names = exporting.map(({ packageName }) => packageName);
      return failed(`${listed} is exported by ${bothOf(names)}: import it from one package`);
    }
    const { packageName, version, exports } = found;
    if (version === undefined) {
      return failed(`${packageName} has no version in its package.json`);
    }
    packages.push({ definitions, packageName, version, exports });
  }
  return { kind: 'resolved', packages };
}

/** Two names as `both a and b`, more as `a, b and c`. */
function bothOf(names: readonly string[]): string {
  const last = names.at(-1);
  const leading = names.slice(0, -1).join(', ');
  return names.length === 2 ? `both ${leading} and ${last}` : `${leading} and ${last}`;
}

function failed(message: string): ResolvedPackages {
  return { kind: 'failed', message };
}
