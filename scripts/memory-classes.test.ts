import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { glob } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import { createVitest, type Vitest } from 'vitest/node';
import { parse } from 'yaml';
import { growthHeapMegabytes } from '../packages/contract/vitest.growth.config.ts';
import { heavyHeapMegabytes } from '../packages/contract/vitest.heavy.config.ts';
import { lightHeapMegabytes } from '../vitest.config.ts';

const root = join(import.meta.dirname, '..');

/** Every project but the two inline ones, whose start writes the README Service; a file named for a class that one of them runs is found by the file system and refused. */
const projectsWithoutInlineOnes = ['!tooling', '!readme-service'];

/**
 * The classes of memory beyond light, with the heap limit in megabytes of their test processes. A
 * class names the files `*.<class>.test.ts` and the projects `*-<class>`, which is how CI selects
 * them. The record is not a second statement of the classes: the first test compares it with the
 * limit every project reports, so a class missing from it fails.
 */
const memoryClasses = { growth: growthHeapMegabytes, heavy: heavyHeapMegabytes } as const;

type MemoryClass = keyof typeof memoryClasses;

const classNames = Object.keys(memoryClasses) as MemoryClass[];

/** The class a project's name says it belongs to, or none for a light project. */
function classOfProject(name: string): MemoryClass | undefined {
  return classNames.find((memoryClass) => name.endsWith(`-${memoryClass}`));
}

/** Vitest as a run resolves the projects its `--project` filters select, among those of `projectsWithoutInlineOnes`, ready to run a file in each. */
function startVitest(filters: readonly string[] = []): Promise<Vitest> {
  return createVitest('test', {
    watch: false,
    root,
    config: join(root, 'vitest.config.ts'),
    project: [...filters, ...projectsWithoutInlineOnes],
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

/** The files named `*.<memoryClass>.test.ts` that the file system holds, found without any project's help, so one that no project finds is found too. */
async function namedFiles(memoryClass: MemoryClass): Promise<string[]> {
  const skipped = new Set(['node_modules', '.readme-service', '.git']);
  const found = glob(`**/*.${memoryClass}.test.ts`, {
    cwd: root,
    exclude: (name) => skipped.has(name),
  });
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

/** What is wrong with where a file named `*.<memoryClass>.test.ts` runs: the projects that run it, when they are not exactly one project of its class. */
function misplacedFiles(
  memoryClass: MemoryClass,
  named: readonly string[],
  filesByProject: ReadonlyMap<string, readonly string[]>,
): string[] {
  const problems: string[] = [];
  for (const file of named) {
    const runIn = [...filesByProject].filter(([, files]) => files.includes(file));
    const [only, ...others] = runIn.map(([name]) => name);
    if (only !== undefined && classOfProject(only) === memoryClass && others.length === 0) {
      continue;
    }
    const projects = runIn.length === 0 ? 'no project' : runIn.map(([name]) => name).join(' and ');
    problems.push(`${relative(root, file)} runs in ${projects}, not in one ${memoryClass} project`);
  }
  return problems;
}

/** What is wrong with the files of a project of `memoryClass`: those not named `*.<memoryClass>.test.ts`. */
function strangersInProjects(
  memoryClass: MemoryClass,
  named: readonly string[],
  filesByProject: ReadonlyMap<string, readonly string[]>,
): string[] {
  const problems: string[] = [];
  for (const [name, files] of filesByProject) {
    const strangers =
      classOfProject(name) === memoryClass ? files.filter((file) => !named.includes(file)) : [];
    for (const file of strangers) {
      problems.push(
        `${relative(root, file)} runs in ${name}, but is not named *.${memoryClass}.test.ts`,
      );
    }
  }
  return problems;
}

/** A `vitest run` command: the `--project` filters it passes, and the `--shard` it passes, if any. */
type Command = { readonly filters: readonly string[]; readonly shard: string | undefined };

/** The value of an option in `command`, quoted or not, with each `${{ matrix.<key> }}` put in. */
function optionOf(
  command: string,
  option: string,
  matrix: Readonly<Record<string, string>>,
): string | undefined {
  const found = command.match(new RegExp(`--${option}[= ]\\s*(?:'([^']*)'|"([^"]*)"|(\\S+))`));
  const value = found?.[1] ?? found?.[2] ?? found?.[3];
  return value?.replace(/\$\{\{\s*matrix\.(\w+)\s*\}\}/g, (_, key) => matrix[key] ?? '');
}

/** Every `vitest run` command in `text`, one for each line it stands on, in the order they stand. */
function commandsIn(text: string, matrix: Readonly<Record<string, string>> = {}): Command[] {
  const commands: Command[] = [];
  for (const line of text.split('\n')) {
    const command = line.match(/\bvitest run\b.*$/)?.[0];
    if (command !== undefined) {
      const filters = [...command.matchAll(/--project\s+(?:'([^']*)'|"([^"]*)"|(\S+))/g)];
      commands.push({
        filters: filters.map(([, single, double, bare]) => single ?? double ?? bare ?? ''),
        shard: optionOf(command, 'shard', matrix),
      });
    }
  }
  return commands;
}

/**
 * The combinations of a job's matrix: the product of its lists, then each `include` entry as a
 * combination of its own. An entry that extends a combination of the lists, or an `exclude`, is
 * not expanded, and throws.
 */
function combinationsOf(matrix: Readonly<Record<string, unknown>>): Record<string, string>[] {
  const { include = [], exclude, ...lists } = matrix;
  if (exclude !== undefined) {
    throw new Error('The matrix has an exclude, which this test does not expand.');
  }
  let combinations: Record<string, string>[] = [{}];
  for (const [key, values] of Object.entries(lists)) {
    combinations = combinations.flatMap((combination) =>
      (values as unknown[]).map((value) => ({ ...combination, [key]: String(value) })),
    );
  }
  const product = [...combinations];
  for (const entry of include as Record<string, unknown>[]) {
    const given = Object.fromEntries(
      Object.entries(entry).map(([key, value]) => [key, String(value)]),
    );
    const extended = product.some((combination) =>
      Object.keys(lists).every((key) => !(key in given) || combination[key] === given[key]),
    );
    if (extended) {
      throw new Error(
        `An include entry extends a combination of the lists, which this test does not expand: ${JSON.stringify(given)}`,
      );
    }
    combinations.push(given);
  }
  return combinations;
}

/** Whether a step with the condition `condition`, a conjunction of `matrix.<key> == '<value>'`, runs for `matrix`. */
function runsFor(condition: unknown, matrix: Readonly<Record<string, string>>): boolean {
  if (condition === undefined) {
    return true;
  }
  const terms = String(condition)
    .replace(/^\$\{\{|\}\}$/g, '')
    .split('&&');
  return terms.every((term) => {
    const tested = term.trim().match(/^matrix\.(\w+) == '([^']*)'$/);
    if (tested === null) {
      throw new Error(`The condition of a vitest step is no test of the matrix: ${condition}`);
    }
    return matrix[tested[1] ?? ''] === tested[2];
  });
}

/** One job of `check`: the values of its matrix, and the `vitest run` commands of the steps that run for them. */
type Leg = { readonly matrix: Readonly<Record<string, string>>; readonly commands: Command[] };

/** The legs of CI's `check` job: its matrix combinations, each with the commands of the steps whose `if` holds for it. */
function legsOfCheck(workflow: string): Leg[] {
  const { strategy, steps } = parse(workflow).jobs.check;
  const vitestSteps = (steps as { if?: unknown; run?: unknown }[]).filter(
    ({ run }) => typeof run === 'string' && /\bvitest run\b/.test(run),
  );
  return combinationsOf(strategy.matrix).map((matrix) => ({
    matrix,
    commands: vitestSteps
      .filter((step) => runsFor(step.if, matrix))
      .flatMap((step) => commandsIn(String(step.run), matrix)),
  }));
}

/** The legs that run one class together, by their matrix without its `shard`: one leg alone, or the shards of one run. */
function groupedByClass(legs: readonly Leg[]): Map<string, Leg[]> {
  const groups = new Map<string, Leg[]>();
  for (const leg of legs) {
    const { shard: _shard, ...rest } = leg.matrix;
    const key = JSON.stringify(rest);
    groups.set(key, [...(groups.get(key) ?? []), leg]);
  }
  return groups;
}

/** What is wrong with the legs of one class: a leg that runs no Vitest, or shards that are not 1/n to n/n, or not alone and unsharded. */
function legProblems(key: string, group: readonly Leg[]): string[] {
  const shards = group.map(
    ({ commands }) => commands.find(({ shard }) => shard !== undefined)?.shard,
  );
  const total = Number(shards[0]?.split('/')[1]);
  const wanted =
    shards[0] === undefined
      ? [undefined]
      : Array.from({ length: total }, (_, index) => `${index + 1}/${total}`);
  const problems = group
    .filter(({ commands }) => commands.length === 0)
    .map(() => `a leg of ${key} runs no vitest command`);
  if (JSON.stringify([...shards].sort()) !== JSON.stringify(wanted)) {
    problems.push(
      `the legs of ${key} run the shards ${shards.map((shard) => shard ?? 'none').join(', ')}, not ${wanted.map((shard) => shard ?? 'none').join(', ')}`,
    );
  }
  return problems;
}

/** The names of the projects each list of `--project` filters selects. */
async function projectsSelectedBy(
  filterLists: readonly (readonly string[])[],
): Promise<string[][]> {
  const selected: string[][] = [];
  for (const filters of filterLists) {
    const vitest = await startVitest(filters);
    try {
      selected.push(vitest.projects.map(({ name }) => name));
    } finally {
      await vitest.close();
    }
  }
  return selected;
}

/** The projects that do not run in exactly one of `runs`, each with how many runs of `what` select it. */
function projectsNotRunOnce(
  all: readonly string[],
  runs: readonly (readonly string[])[],
  what: string,
): string[] {
  const problems: string[] = [];
  for (const name of all) {
    const count = runs.filter((projects) => projects.includes(name)).length;
    if (count !== 1) {
      problems.push(`${name} runs in ${count} of ${what}, not in exactly one`);
    }
  }
  return problems;
}

describe('the memory classes of the test run', () => {
  test("every project's test process gets its class's heap limit", async () => {
    const vitest = await startVitest();
    const directory = mkdtempSync(join(tmpdir(), 'memory-classes-'));
    try {
      const lightLimit = heapLimitOf(lightHeapMegabytes);
      const wanted = Object.fromEntries(
        vitest.projects.map(({ name }) => {
          const memoryClass = classOfProject(name);
          return [
            name,
            memoryClass === undefined ? lightLimit : heapLimitOf(memoryClasses[memoryClass]),
          ];
        }),
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

  test('a file named for a memory class runs only in a project of that class, and such a project runs nothing else', async () => {
    const vitest = await startVitest();
    try {
      const filesByProject = await testFilesByProject(vitest);

      const problems: string[] = [];
      for (const memoryClass of classNames) {
        const named = await namedFiles(memoryClass);
        for (const problem of [
          ...misplacedFiles(memoryClass, named, filesByProject),
          ...strangersInProjects(memoryClass, named, filesByProject),
        ]) {
          problems.push(problem);
        }
      }

      expect(problems).toEqual([]);
    } finally {
      await vitest.close();
    }
  });

  test("each project runs in exactly one class of CI's legs, whose shards are 1/n to n/n, and in exactly one of pnpm test and pnpm test:growth", async () => {
    const vitest = await startVitest();
    try {
      const all = vitest.projects.map(({ name }) => name);
      const workflow = readFileSync(join(root, '.github', 'workflows', 'ci.yml'), 'utf8');
      const { scripts } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
      const missing = ['test', 'test:growth'].filter((name) => typeof scripts[name] !== 'string');

      const groups = groupedByClass(legsOfCheck(workflow));
      const classes: string[][] = [];
      const problems: string[] = [];
      for (const [key, group] of groups) {
        for (const problem of legProblems(key, group)) {
          problems.push(problem);
        }
        const selected = await projectsSelectedBy(
          group.flatMap(({ commands }) => commands.map(({ filters }) => filters)),
        );
        classes.push([...new Set(selected.flat())]);
      }
      const local = await projectsSelectedBy(
        commandsIn(`${scripts.test}\n${scripts['test:growth']}`).map(({ filters }) => filters),
      );

      expect([
        ...missing.map((name) => `package.json has no ${name} script`),
        ...problems,
        ...projectsNotRunOnce(all, classes, "CI's classes of legs"),
        ...projectsNotRunOnce(all, local, 'pnpm test and pnpm test:growth'),
      ]).toEqual([]);
    } finally {
      await vitest.close();
    }
  });
});
