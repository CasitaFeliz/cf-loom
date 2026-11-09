import { defineProject } from 'vitest/config';
import { hangTimeout } from '../../scripts/hang-timeout.ts';

export default defineProject({
  test: {
    name: '@cf-loom/cli',
    setupFiles: ['./test/no-registry.ts'],
    testTimeout: hangTimeout,
    hookTimeout: hangTimeout,
  },
});
