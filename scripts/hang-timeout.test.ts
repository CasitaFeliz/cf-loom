import { join } from 'node:path';
import { expect, test } from 'vitest';
import { createVitest } from 'vitest/node';
import { hangTimeout } from './hang-timeout.ts';

const root = join(import.meta.dirname, '..');

/** The timeouts of every project Vitest resolves from the root configuration, inline projects included, by project name. */
async function resolvedTimeouts(): Promise<string[]> {
  const vitest = await createVitest('test', {
    watch: false,
    root,
    config: join(root, 'vitest.config.ts'),
    reporters: [],
  });
  try {
    return vitest.projects.map(
      ({ name, config }) => `${name}: test ${config.testTimeout}, hook ${config.hookTimeout}`,
    );
  } finally {
    await vitest.close();
  }
}

test('every project Vitest resolves from the root configuration gives its tests and hooks the hang bound', async () => {
  const given = await resolvedTimeouts();

  expect(given.length).toBeGreaterThan(0);
  expect(
    given.filter((project) => !project.endsWith(`test ${hangTimeout}, hook ${hangTimeout}`)),
  ).toEqual([]);
});
