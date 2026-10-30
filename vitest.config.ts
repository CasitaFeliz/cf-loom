import { join } from 'node:path';
import { configDefaults, defineConfig } from 'vitest/config';
import { writeReadmeService } from './scripts/readme-snippets.ts';

/** The lint plugin tests each spawn Biome, and some script tests spawn Node, which takes seconds on a CI runner with shared cores. */
const spawningTimeout = 30_000;

/** Written before any test file is collected, since a project's own setup runs after: see CLAUDE.md. */
const readmeService = join(import.meta.dirname, '.readme-service');
writeReadmeService(readmeService);

export default defineConfig({
  test: {
    projects: [
      'packages/*',
      'examples/*',
      {
        test: {
          name: 'tooling',
          include: ['lint/**/*.test.ts', 'scripts/**/*.test.ts'],
          exclude: [...configDefaults.exclude, 'scripts/readme-service/**'],
          testTimeout: spawningTimeout,
        },
      },
      {
        test: {
          name: 'readme-service',
          include: ['.readme-service/test/**/*.test.ts'],
          setupFiles: ['scripts/readme-service-written.ts'],
          testTimeout: spawningTimeout,
        },
      },
    ],
  },
});
