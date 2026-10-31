import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import { createVitest, type Vitest } from 'vitest/node';
import { lightHeapMegabytes } from '../vitest.config.ts';

const root = join(import.meta.dirname, '..');

/** Every project but the two inline ones, which write the README Service when Vitest starts them and hold no file that needs a heap of its own. */
const projectsWithoutInlineOnes = ['!tooling', '!readme-service'];

/** Vitest as `pnpm test` resolves it: every project the root configuration lists, ready to run a file in each. */
function startVitest(): Promise<Vitest> {
  return createVitest('test', {
    watch: false,
    root,
    config: join(root, 'vitest.config.ts'),
    project: projectsWithoutInlineOnes,
    reporters: [],
  });
}

/** The heap limit, in bytes, of a Node started with `--max-old-space-size` and no `NODE_OPTIONS`: what a test process of that budget must report. */
function heapLimitOf(megabytes: number): number {
  const { NODE_OPTIONS: _inherited, ...environment } = process.env;
  const printed = execFileSync(
    process.execPath,
    [
      `--max-old-space-size=${megabytes}`,
      '-p',
      "require('node:v8').getHeapStatistics().heap_size_limit",
    ],
    { encoding: 'utf8', env: environment },
  );
  return Number(printed);
}

/** A test file that appends the project it runs in and the heap limit of its process to `reportPath`. */
function reportsItsHeapLimit(reportPath: string): string {
  return `
import { appendFileSync } from 'node:fs';
import { getHeapStatistics } from 'node:v8';
import { test } from 'vitest';

test('reports its heap limit', ({ task }) => {
  const report = { project: task.file.projectName, limit: getHeapStatistics().heap_size_limit };
  appendFileSync(${JSON.stringify(reportPath)}, \`\${JSON.stringify(report)}\\n\`);
});
`;
}

/** Runs the file in every project of `vitest` with no `NODE_OPTIONS` of this process to inherit, so the root configuration is the only source of a budget, and returns each project's heap limit. */
async function heapLimitsAfterRunningIn(
  vitest: Vitest,
  directory: string,
): Promise<Record<string, number>> {
  const specFile = join(directory, 'heap-limit.test.ts');
  const reportPath = join(directory, 'reports.jsonl');
  writeFileSync(specFile, reportsItsHeapLimit(reportPath));
  vi.stubEnv('NODE_OPTIONS', undefined);
  try {
    await vitest.runTestSpecifications(
      vitest.projects.map((project) => project.createSpecification(specFile)),
    );
  } finally {
    vi.unstubAllEnvs();
  }
  const reports = readFileSync(reportPath, 'utf8').trim().split('\n');
  return Object.fromEntries(
    reports.map((line) => JSON.parse(line)).map(({ project, limit }) => [project, limit]),
  );
}

describe('the memory classes of the test run', () => {
  test("every project's test process gets its class's heap limit", async () => {
    const directory = mkdtempSync(join(tmpdir(), 'memory-classes-'));
    const vitest = await startVitest();
    try {
      const budgetLimit = heapLimitOf(lightHeapMegabytes);
      const wanted = Object.fromEntries(vitest.projects.map(({ name }) => [name, budgetLimit]));

      const reported = await heapLimitsAfterRunningIn(vitest, directory);

      expect(reported).toEqual(wanted);
    } finally {
      await vitest.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test('every project runs its test files in forked processes, which the heap limit reaches', async () => {
    const vitest = await startVitest();
    try {
      const forked = new Set(['forks', 'vmForks']);

      const notForked = vitest.projects
        .filter(({ config }) => !forked.has(config.pool))
        .map(({ name, config }) => `${name}: ${config.pool}`);

      expect(notForked).toEqual([]);
    } finally {
      await vitest.close();
    }
  });
});
