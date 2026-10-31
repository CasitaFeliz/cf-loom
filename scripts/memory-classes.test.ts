import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { glob } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import { createVitest, type TestProject, type Vitest } from 'vitest/node';
import { heavyHeapMegabytes } from '../packages/contract/vitest.heavy.config.ts';
import { lightHeapMegabytes } from '../vitest.config.ts';

const root = join(import.meta.dirname, '..');

/** Every project but the two inline ones, which write the README Service when Vitest starts them and hold no file that needs a heap of its own. */
const projectsWithoutInlineOnes = ['!tooling', '!readme-service'];

/** How a project that runs the files named `*.heavy.test.ts` is named, which is how CI selects it. */
const heavySuffix = '-heavy';

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

/** The budget a project's test processes get: the heavy one for a project that runs heavy files, else the light one. */
function budgetOf(project: TestProject): number {
  return project.name.endsWith(heavySuffix) ? heavyHeapMegabytes : lightHeapMegabytes;
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

/** What running the file in every project reported: each project's heap limit, and the errors the run itself raised. */
type HeapRun = { readonly limits: Record<string, number>; readonly errors: readonly unknown[] };

/** Runs the file in every project of `vitest` with no `NODE_OPTIONS` of this process to inherit, so the root configuration is the only source of a budget. */
async function runningInEveryProject(vitest: Vitest, directory: string): Promise<HeapRun> {
  const specFile = join(directory, 'heap-limit.test.ts');
  const reportPath = join(directory, 'reports.jsonl');
  writeFileSync(specFile, reportsItsHeapLimit(reportPath));
  writeFileSync(reportPath, '');
  vi.stubEnv('NODE_OPTIONS', undefined);
  try {
    const { unhandledErrors } = await vitest.runTestSpecifications(
      vitest.projects.map((project) => project.createSpecification(specFile)),
    );
    const reports = readFileSync(reportPath, 'utf8')
      .split('\n')
      .filter((line) => line !== '');
    const limits = reports.map((line) => JSON.parse(line));
    return {
      limits: Object.fromEntries(limits.map(({ project, limit }) => [project, limit])),
      errors: unhandledErrors,
    };
  } finally {
    vi.unstubAllEnvs();
  }
}

/** The files named `*.heavy.test.ts` that the file system holds, found without any project's help, so one that no project finds is found too. */
async function heavyNamedFiles(): Promise<string[]> {
  const skipped = new Set(['node_modules', '.readme-service', '.git']);
  const found = glob('**/*.heavy.test.ts', { cwd: root, exclude: (name) => skipped.has(name) });
  const paths: string[] = [];
  for await (const path of found) {
    paths.push(join(root, path));
  }
  return paths;
}

/** The test files each project of `vitest` runs, by the project's name. */
async function testFilesByProject(vitest: Vitest): Promise<Map<string, string[]>> {
  const filesByProject = new Map<string, string[]>();
  for (const project of vitest.projects) {
    const { testFiles } = await project.globTestFiles();
    filesByProject.set(project.name, testFiles);
  }
  return filesByProject;
}

/** What is wrong with where a file named `*.heavy.test.ts` runs: the projects that run it, when they are not exactly one heavy project. */
function misplacedHeavyFiles(
  heavyNamed: readonly string[],
  filesByProject: ReadonlyMap<string, readonly string[]>,
): string[] {
  const problems: string[] = [];
  for (const file of heavyNamed) {
    const runIn = [...filesByProject].filter(([, files]) => files.includes(file));
    const [only, ...others] = runIn.map(([name]) => name);
    if (only?.endsWith(heavySuffix) && others.length === 0) {
      continue;
    }
    const projects = runIn.length === 0 ? 'no project' : runIn.map(([name]) => name).join(' and ');
    problems.push(`${relative(root, file)} runs in ${projects}, not in one heavy project`);
  }
  return problems;
}

/** What is wrong with a heavy project's files: those not named `*.heavy.test.ts`. */
function lightFilesInHeavyProjects(
  heavyNamed: readonly string[],
  filesByProject: ReadonlyMap<string, readonly string[]>,
): string[] {
  const problems: string[] = [];
  for (const [name, files] of filesByProject) {
    const strangers = name.endsWith(heavySuffix)
      ? files.filter((f) => !heavyNamed.includes(f))
      : [];
    for (const file of strangers) {
      problems.push(`${relative(root, file)} runs in ${name}, but is not named *.heavy.test.ts`);
    }
  }
  return problems;
}

describe('the memory classes of the test run', () => {
  test("every project's test process gets its class's heap limit", async () => {
    const directory = mkdtempSync(join(tmpdir(), 'memory-classes-'));
    const vitest = await startVitest();
    try {
      const wanted = Object.fromEntries(
        vitest.projects.map((project) => [project.name, heapLimitOf(budgetOf(project))]),
      );

      const run = await runningInEveryProject(vitest, directory);

      expect(run).toEqual({ limits: wanted, errors: [] });
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

  test('a file named *.heavy.test.ts runs only in a heavy project, and a heavy project runs nothing else', async () => {
    const vitest = await startVitest();
    try {
      const heavyNamed = await heavyNamedFiles();
      const filesByProject = await testFilesByProject(vitest);

      const problems = [
        ...misplacedHeavyFiles(heavyNamed, filesByProject),
        ...lightFilesInHeavyProjects(heavyNamed, filesByProject),
      ];

      expect(problems).toEqual([]);
    } finally {
      await vitest.close();
    }
  });
});
