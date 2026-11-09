import { defineProject } from 'vitest/config';
import { hangTimeout } from '../../scripts/hang-timeout.ts';

export default defineProject({
  test: {
    name: '@org/billing-service',
    testTimeout: hangTimeout,
    hookTimeout: hangTimeout,
  },
});
