import { defineProject } from 'vitest/config';

/** Its tests that run cf-loom take seconds on a CI runner with shared cores. */
const spawningTimeout = 60_000;

export default defineProject({
  test: {
    name: '@org/billing-service',
    testTimeout: spawningTimeout,
    hookTimeout: spawningTimeout,
  },
});
