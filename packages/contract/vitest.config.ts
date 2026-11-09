import { configDefaults, defineProject } from 'vitest/config';
import { hangTimeout } from '../../scripts/hang-timeout.ts';

/** The files that need more memory than the light budget, which run in the heavy project and nowhere else. */
export const heavyTestFiles = '**/*.heavy.test.ts';

/** The files of a growth family, which run in the growth project and nowhere else. */
export const growthTestFiles = '**/*.growth.test.ts';

export default defineProject({
  test: {
    name: '@cf-loom/contract',
    testTimeout: hangTimeout,
    hookTimeout: hangTimeout,
    exclude: [...configDefaults.exclude, heavyTestFiles, growthTestFiles],
  },
});
