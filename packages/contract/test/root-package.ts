import type { Definitions } from '../src/index.ts';
import type { ExportsOf, RootPackage } from '../src/internal/index.ts';

/**
 * The package a test's root sits in: named as the root is, or `@org/definitions` for a
 * Definitions Package, with no Definitions Package installed and no schema from one, unless the
 * test gives otherwise; each installed package's exports are what it exports.
 */
export function aRootPackage(root: unknown, given: Partial<RootPackage> = {}): RootPackage {
  const name = typeof root === 'object' && root !== null ? Reflect.get(root, 'name') : undefined;
  const packages = given.packages ?? [];
  return {
    packageName: typeof name === 'string' ? name : '@org/definitions',
    packages,
    originOf: () => undefined,
    exportsOf: (definitions) =>
      packages.find((resolved) => resolved.definitions === definitions)?.exports ?? {},
    ...given,
  };
}

/** What each of a test's Definitions Packages exports beside its Definitions object, by name. */
export function exporting(
  ...packages: readonly (readonly [Definitions, Readonly<Record<string, unknown>>])[]
): ExportsOf {
  const byDefinitions = new Map(packages);
  return (definitions) => {
    const exported = byDefinitions.get(definitions);
    return exported === undefined ? {} : { definitions, ...exported };
  };
}
