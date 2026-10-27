import { defineProject } from 'vitest/config';

/** Each test spawns Node processes, which take seconds on a CI runner with shared cores. */
const spawningTimeout = 60_000;

export default defineProject({
  test: {
    name: '@cf-loom/cli',
    setupFiles: ['./test/no-registry.ts'],
    testTimeout: spawningTimeout,
    hookTimeout: spawningTimeout,
  },
});
