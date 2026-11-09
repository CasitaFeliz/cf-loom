import { defineProject } from 'vitest/config';
import { hangTimeout } from '../../scripts/hang-timeout.ts';

export default defineProject({
  test: {
    name: '@cf-loom/server',
    testTimeout: hangTimeout,
    hookTimeout: hangTimeout,
  },
});
