import { defineConfig } from 'vitest/config';

/** The fixtures of `test-processes.test.ts`, which that test runs with Vitest of its own: they are not tests of this project. */
export default defineConfig({
  test: {
    include: ['*.fixture.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
