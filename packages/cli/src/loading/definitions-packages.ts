import { type ImportedDefinitions, isDefinitions } from '@cf-loom/contract/internal';
import { exportersOf, linkedPackagesOf } from './exporting-packages.ts';
import type { ImportedPackage } from './imported-packages.ts';

/**
 * Every Definitions object an imported package exports, once per package however many of its
 * modules export it, each package as its package.json names it or not; with the other packages
 * its files import, directly or through any package.
 */
export function definitionsPackagesOf(
  imported: readonly ImportedPackage[],
): readonly ImportedDefinitions[] {
  return linkedPackagesOf(imported, exportersOf(imported, isDefinitions), ({ module, value }) => ({
    definitions: value,
    exports: module.exports,
  }));
}
