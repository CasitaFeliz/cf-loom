import { defineProject } from 'vitest/config';

/** Its tests that start a server take seconds on a CI runner with shared cores. */
const spawningTimeout = 60_000;

export default defineProject({
  test: {
    name: '@cf-loom/messaging',
    testTimeout: spawningTimeout,
    hookTimeout: spawningTimeout,
  },
});
