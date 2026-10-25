import type { RootPackage } from '@cf-loom/contract/internal';

/**
 * The package a test's root sits in: named as the root is, with no Definitions Package installed,
 * unless the test gives otherwise.
 */
export function aRootPackage(root: unknown, given: Partial<RootPackage> = {}): RootPackage {
  const name = typeof root === 'object' && root !== null ? Reflect.get(root, 'name') : undefined;
  return {
    packageName: typeof name === 'string' ? name : '@org/definitions',
    packages: [],
    unidentified: [],
    rootExports: {},
    ...given,
  };
}
