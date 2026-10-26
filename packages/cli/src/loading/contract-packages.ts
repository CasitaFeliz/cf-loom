import { type ImportedContractPackage, isContractPackage } from '@cf-loom/contract/internal';
import { exportersOf, linkedPackagesOf } from './exporting-packages.ts';
import type { ImportedPackage } from './imported-packages.ts';

/**
 * Every `contract` of a Contract Package that an imported package exports, once per package however
 * many of its modules export it, each package as its package.json names it or not; with the other
 * packages its files import, directly or through any package.
 */
export function contractPackagesOf(
  imported: readonly ImportedPackage[],
): readonly ImportedContractPackage[] {
  return linkedPackagesOf(
    imported,
    exportersOf(imported, isContractPackage),
    ({ module, value }, reaches): ImportedContractPackage => ({
      ...module.identity,
      contract: value,
      reaches,
    }),
  );
}
