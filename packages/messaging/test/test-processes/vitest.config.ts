import { defineConfig } from 'vitest/config';

/**
 * The fixtures of `test-processes.test.ts`, which that test runs with Vitest of its own: they are not tests of this
 * project. Only the steps a fixture times out are timed; the test that runs it bounds the rest. No results are cached.
 * It runs in threads, so the Vitest the test starts has no worker process: killing it leaves running only the stub
 * servers, which end themselves.
 */
export default defineConfig({
  test: {
    include: ['*.fixture.ts'],
    testTimeout: 0,
    hookTimeout: 0,
    cache: false,
    pool: 'threads',
  },
});
