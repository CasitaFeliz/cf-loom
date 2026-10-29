import { defineProject } from 'vitest/config';

/**
 * Many tests walk, compare or decode thousands of schemas, or check generated histories, which takes
 * up to 3 s while the project's files run in parallel, and several times that on a CI runner that
 * several runs share. A test whose purpose is a time bound measures CPU time or growth instead.
 */
const heavyTimeout = 60_000;

export default defineProject({
  test: {
    name: '@cf-loom/contract',
    testTimeout: heavyTimeout,
  },
});
