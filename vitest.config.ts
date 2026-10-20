import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      'packages/*',
      'examples/*',
      { test: { name: 'tooling', include: ['lint/**/*.test.ts', 'scripts/**/*.test.ts'] } },
    ],
  },
});
