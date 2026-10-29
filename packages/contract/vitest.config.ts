import { defineProject } from 'vitest/config';

/**
 * Many tests walk, compare or decode thousands of schemas, or check generated histories, which a CI
 * runner that several runs share stretches several times over. A test whose purpose is a time bound
 * measures CPU time or growth instead.
 */
const heavyTimeout = 60_000;

export default defineProject({
  test: {
    name: '@cf-loom/contract',
    testTimeout: heavyTimeout,
  },
});
