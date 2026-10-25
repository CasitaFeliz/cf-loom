import type { Definitions } from '../src/index.ts';
import type { ResolvedDefinitions, RootPackage } from '../src/internal/index.ts';

/**
 * The package a test's root sits in: named as the root is, or `@org/definitions` for a
 * Definitions Package, with no Definitions Package installed and a root file that exports
 * nothing else, unless the test gives otherwise.
 */
export function aRootPackage(root: unknown, given: Partial<RootPackage> = {}): RootPackage {
  const name = typeof root === 'object' && root !== null ? Reflect.get(root, 'name') : undefined;
  return {
    packageName: typeof name === 'string' ? name : '@org/definitions',
    packages: [],
    rootExports: {},
    ...given,
  };
}

/** A Definitions Package installed beside a test's root, exporting what is given beside its Definitions object. */
export function anInstalledPackage(
  definitions: Definitions,
  exported: Readonly<Record<string, unknown>>,
  installed: Partial<ResolvedDefinitions> = {},
): ResolvedDefinitions {
  return {
    definitions,
    packageName: '@org/definitions',
    version: '4.2.0',
    exports: { definitions, ...exported },
    reaches: [],
    ...installed,
  };
}
