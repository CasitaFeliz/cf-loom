import { defineProject } from 'vitest/config';

/** Each test spawns cf-loom, which takes seconds on a CI runner with shared cores. */
const spawningTimeout = 60_000;

export default defineProject({
  test: {
    name: '@org/billing-service',
    testTimeout: spawningTimeout,
    hookTimeout: spawningTimeout,
  },
});
