import { defineConfig } from 'vitest/config';

/** The lint plugin tests each spawn Biome, and some script tests spawn Node, which takes seconds on a CI runner with shared cores. */
const spawningTimeout = 30_000;

export default defineConfig({
  test: {
    projects: [
      'packages/*',
      'examples/*',
      {
        test: {
          name: 'tooling',
          include: ['lint/**/*.test.ts', 'scripts/**/*.test.ts'],
          testTimeout: spawningTimeout,
        },
      },
    ],
  },
});
