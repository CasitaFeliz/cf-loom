import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { bin, type Ran } from './cf-loom-run.ts';
import { aDeadAddress } from './dead-address.ts';

const cliDir = join(import.meta.dirname, '..');
const packagesDir = join(cliDir, '..');
const projects: string[] = [];
const fixtures: string[] = [];

/** Removes the projects of the test that ran, for an `afterEach`. */
export function removeProjects(): void {
  for (const project of projects.splice(0)) {
    rmSync(project, { recursive: true, force: true });
  }
}

/** Removes the fixtures of the file that ran, for an `afterAll`. */
export function removeFixtures(): void {
  for (const fixture of fixtures.splice(0)) {
    rmSync(fixture, { recursive: true, force: true });
  }
}

/** A project in a temporary directory, with cf-loom, its handlers and zod installed. */
function makeProject(files: Readonly<Record<string, string>>, name: string): string {
  const project = mkdtempSync(join(tmpdir(), `cf-loom-${name}-`));
  link(join(packagesDir, 'contract'), join(project, 'node_modules/@cf-loom/contract'));
  link(join(packagesDir, 'handlers'), join(project, 'node_modules/@cf-loom/handlers'));
  link(cliDir, join(project, 'node_modules/@cf-loom/cli'));
  link(realpathSync(join(cliDir, 'node_modules/zod')), join(project, 'node_modules/zod'));
  write(project, files);
  return project;
}

/** A project that `removeProjects` removes when the test ends. */
export function aProject(files: Readonly<Record<string, string>>): string {
  const project = makeProject(files, 'project');
  projects.push(project);
  return project;
}

/** A project that `removeFixtures` removes when the file's tests end, to build once in a `beforeAll`. */
export function aFixture(files: Readonly<Record<string, string>>): string {
  const project = makeProject(files, 'fixture');
  fixtures.push(project);
  return project;
}

function link(target: string, path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  symlinkSync(target, path, 'dir');
}

/** Writes the files into the project, replacing the ones that exist. */
export function write(project: string, files: Readonly<Record<string, string>>): void {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(project, path)), { recursive: true });
    writeFileSync(join(project, path), text);
  }
}

/** Runs the CLI in the project. */
export function cfLoom(project: string, ...args: string[]): Ran {
  const ran = spawnSync(process.execPath, [bin, ...args], { cwd: project, encoding: 'utf8' });
  return { status: ran.status, stdout: ran.stdout, stderr: ran.stderr };
}

/** Runs the CLI with no npm on PATH and the registry set to an address nothing listens on. */
export async function cfLoomOffline(project: string, ...args: string[]): Promise<Ran> {
  const dead = await aDeadAddress();
  try {
    const emptyPath = mkdtempSync(join(tmpdir(), 'cf-loom-no-npm-'));
    projects.push(emptyPath);
    const env = Object.fromEntries([
      ...Object.entries(process.env),
      ['PATH', emptyPath],
      ['npm_config_registry', dead.url],
    ]);
    const options = { cwd: project, env, encoding: 'utf8' } as const;
    const ran = spawnSync(process.execPath, [bin, ...args], options);
    return { status: ran.status, stdout: ran.stdout, stderr: ran.stderr };
  } finally {
    dead.release();
  }
}

/** The project after `generate` wrote its Snapshot, which the commands that write from it read. */
export function generated(project: string): string {
  const ran = cfLoom(project, 'generate');
  if (ran.status !== 0) {
    throw new Error(`generate failed: ${ran.stderr}`);
  }
  return project;
}

/** A project that `generate` ran in, removed when the test ends. */
export function aGeneratedProject(files: Readonly<Record<string, string>>): string {
  return generated(aProject(files));
}

/** The lines of a file, each ended by a newline. */
export function lines(written: readonly string[]): string {
  return `${written.join('\n')}\n`;
}

/** The value a document holds after the steps, or `undefined` where a step finds nothing. */
export function valueAt(root: unknown, ...steps: readonly string[]): unknown {
  let value = root;
  for (const step of steps) {
    value = typeof value === 'object' && value !== null ? Reflect.get(value, step) : undefined;
  }
  return value;
}

/** The keys of an object of the document. */
export function keysOf(value: unknown): readonly string[] {
  return typeof value === 'object' && value !== null ? Object.keys(value) : [];
}

/** The line a command that works from the committed Snapshot ends with when it is not current. */
export const staleSnapshotLine =
  'contract.snapshot.json is missing or out of date: run cf-loom generate';

const manifest = JSON.stringify({ name: '@org/orders-service', type: 'module' });

const config = lines([
  "import { defineConfig } from '@cf-loom/cli';",
  '',
  'export const config = defineConfig({});',
]);

/** A project around a Service's Root file named `orders-service`, with the CLI's configuration. */
export function aContractProject(root: readonly string[]): Readonly<Record<string, string>> {
  return {
    'package.json': manifest,
    'cf-loom.config.ts': config,
    'src/contract/index.ts': lines(root),
  };
}

/** The files of a project whose Root is an Application’s Contract. */
export const anApplication: Readonly<Record<string, string>> = {
  'package.json': manifest,
  'cf-loom.config.ts': config,
  'src/contract/index.ts': lines([
    "import { defineApplication } from '@cf-loom/contract';",
    "export const application = defineApplication({ name: 'orders-service', dependencies: [] });",
  ]),
};

/** The files of a project whose Root is a Definitions Package. */
export const aDefinitionsPackage: Readonly<Record<string, string>> = {
  'package.json': manifest,
  'cf-loom.config.ts': config,
  'src/definitions/index.ts': lines([
    "import { defineDefinitions } from '@cf-loom/contract';",
    'export const definitions = defineDefinitions({});',
  ]),
};
