import { configDefaults, defineProject } from 'vitest/config';

/**
 * Many tests walk, compare or decode thousands of schemas, or check generated histories, which a CI
 * runner that several runs share stretches several times over. A test whose purpose is a time bound
 * measures CPU time or growth instead.
 */
export const contractTimeout = 60_000;

/** The files that need more memory than the light budget, which run in the heavy project and nowhere else. */
export const heavyTestFiles = '**/*.heavy.test.ts';

/** The files of a growth family, which run in the growth project and nowhere else. */
export const growthTestFiles = '**/*.growth.test.ts';

export default defineProject({
  test: {
    name: '@cf-loom/contract',
    testTimeout: contractTimeout,
    exclude: [...configDefaults.exclude, heavyTestFiles, growthTestFiles],
  },
});
