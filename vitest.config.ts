import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { configDefaults, defineConfig } from 'vitest/config';
import { writeReadmeService } from './scripts/readme-snippets.ts';

declare module 'vitest' {
  interface ProvidedContext {
    /** The folder this Vitest process wrote the README Service to. */
    readmeService: string;
  }
}

/** The lint plugin tests each spawn Biome, and some script tests spawn Node, which takes seconds on a CI runner with shared cores. */
const spawningTimeout = 30_000;

/**
 * Written before any test file is collected, since a project's own setup runs after: see CLAUDE.md.
 * Each Vitest process writes a folder of its own, so a second process in the checkout never replaces
 * the files this one's tests read, and removes it when it exits. Vitest loads this file again, in the
 * same process, when it restarts for a change to it: that load rewrites the folder, which only an
 * earlier load can have made, and registers no second removal.
 */
const readmeService = join(
  import.meta.dirname,
  '.readme-service',
  `${process.pid}-${performance.timeOrigin}`,
);
const loadedBefore = existsSync(readmeService);
if (!loadedBefore) {
  process.on('exit', () => rmSync(readmeService, { recursive: true, force: true }));
}
writeReadmeService(readmeService);

const provide = { readmeService };

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
          provide,
        },
      },
      {
        test: {
          name: 'readme-service',
          dir: readmeService,
          include: ['test/**/*.test.ts'],
          setupFiles: ['scripts/readme-service-written.ts'],
          testTimeout: spawningTimeout,
          fsModuleCache: false,
          provide,
        },
      },
    ],
  },
});
