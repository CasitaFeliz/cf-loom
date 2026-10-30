import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from 'vite';
import { configDefaults, defineConfig } from 'vitest/config';
import { writeReadmeService } from './scripts/readme-snippets.ts';

declare module 'vitest' {
  interface ProvidedContext {
    /** The folder this Vitest wrote the README Service to. */
    readmeService: string;
  }
}

/** The lint plugin tests each spawn Biome, and some script tests spawn Node, which takes seconds on a CI runner with shared cores. */
const spawningTimeout = 30_000;

/** The folder of this Vitest's README Service, named anew each time Vitest reads this file, so each Vitest and each restart of one has a folder of its own. */
const readmeService = join(
  import.meta.dirname,
  '.readme-service',
  `${process.pid}-${randomUUID()}`,
);

/**
 * Writes the README Service when Vitest starts a project it is provided to, before any test file is
 * collected, since a project's own setup runs after (see CLAUDE.md), and removes it when that Vitest
 * closes, or when the process exits first.
 */
const readmeServiceOwner: Plugin = {
  name: 'cf-loom:readme-service',
  configureVitest({ vitest, project }) {
    if (project !== vitest.projects.find(({ config }) => config.provide.readmeService)) {
      return;
    }
    const remove = () => rmSync(readmeService, { recursive: true, force: true });
    process.once('exit', remove);
    vitest.onClose(() => {
      process.off('exit', remove);
      remove();
    });
    writeReadmeService(readmeService);
  },
};

const provide = { readmeService };

export default defineConfig({
  plugins: [readmeServiceOwner],
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
