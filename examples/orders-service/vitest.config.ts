import { defineProject } from 'vitest/config';
import { hangTimeout } from '../../scripts/hang-timeout.ts';

export default defineProject({
  test: {
    name: '@org/orders-service',
    testTimeout: hangTimeout,
    hookTimeout: hangTimeout,
  },
});
