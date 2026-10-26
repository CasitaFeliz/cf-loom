import { type ImportedContractPackage, providerOf } from '@cf-loom/contract/internal';
import { type Exporter, exportersOf, linkedPackagesOf } from './exporting-packages.ts';
import type { ImportedPackage } from './imported-packages.ts';

/**
 * Every imported package whose modules export Provided Elements, once per package however many of
 * its modules export them, with all of them, each package as its package.json names it or not;
 * with the other such packages its files import, directly or through any package.
 */
export function contractPackagesOf(
  imported: readonly ImportedPackage[],
): readonly ImportedContractPackage[] {
  return linkedPackagesOf(
    imported,
    byPackageOf(exportersOf(imported, isProvidedElement)),
    ({ module, value }, reaches): ImportedContractPackage => ({
      ...module.identity,
      elements: value,
      reaches,
    }),
  );
}

/** A value its Provider's name marks: an Element a Contract Package exports. */
function isProvidedElement(value: unknown): value is object {
  return providerOf(value) !== undefined;
}

/** The exporters of one package, by its package.json, as one exporter of all their Elements. */
function byPackageOf(exporters: readonly Exporter<object>[]): readonly Exporter<unknown[]>[] {
  const byManifest = new Map<string, Exporter<unknown[]>>();
  for (const { module, value } of exporters) {
    const known = byManifest.get(module.manifestPath) ?? { module, value: [] };
    known.value.push(value);
    byManifest.set(module.manifestPath, known);
  }
  return [...byManifest.values()];
}
