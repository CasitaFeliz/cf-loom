import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from 'vite';
import { configDefaults, defineConfig } from 'vitest/config';
import { hangTimeout } from './scripts/hang-timeout.ts';
import { writeReadmeService } from './scripts/readme-snippets.ts';

declare module 'vitest' {
  interface ProvidedContext {
    /** The folder this Vitest wrote the README Service to. */
    readmeService: string;
  }
}

/**
 * The heap limit in megabytes of every test process, so that the 7 processes Vitest starts on an
 * 8-core runner (`availableParallelism() - 1`) fit its memory: all 7 at their limit were measured at
 * about 6.4 GB with Vitest's own process, before servers and children, and 640 is the measured
 * fallback. It reaches the processes as `NODE_OPTIONS`, which the `env` replaces and does not append
 * to, so a developer's own `NODE_OPTIONS` never reaches a test process.
 */
export const lightHeapMegabytes = 768;

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
    // biome-ignore lint/style/useNamingConvention: the name of an environment variable
    env: { NODE_OPTIONS: `--max-old-space-size=${lightHeapMegabytes}` },
    testTimeout: hangTimeout,
    hookTimeout: hangTimeout,
    projects: [
      'packages/*',
      'packages/*/vitest.heavy.config.ts',
      'packages/*/vitest.growth.config.ts',
      'examples/*',
      {
        test: {
          name: 'tooling',
          include: ['lint/**/*.test.ts', 'scripts/**/*.test.ts'],
          exclude: [...configDefaults.exclude, 'scripts/readme-service/**'],
          provide,
        },
      },
      {
        test: {
          name: 'readme-service',
          dir: readmeService,
          include: ['test/**/*.test.ts'],
          setupFiles: ['scripts/readme-service-written.ts'],
          fsModuleCache: false,
          provide,
        },
      },
    ],
  },
});
