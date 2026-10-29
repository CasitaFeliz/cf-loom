import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { packagesAt } from './readme-project.ts';

/** What cf-loom refused in one of the README Service's Services: a file of the project and its line, when it names one. */
export type CfLoomProblem = {
  readonly path: string | undefined;
  readonly row: number;
  readonly message: string;
};

const cli = join(import.meta.dirname, '..', 'packages', 'cli', 'dist', 'bin.js');
const refusedAt = 'cf-loom-refused.json';
const definitionsPackage = 'definitions';
/** Long enough for a slow runner, short enough that a hung CLI fails the write-out. */
const timeoutMs = 60_000;
const cliLine = /^(src\/\S+?\.ts)(?::(\d+))?:? (.*)$/;

/**
 * The README Service's other Services: each folder the scope gives a `package.json`, named
 * `@org/<folder>`, but the Definitions Package's.
 */
function servicesOf(paths: readonly string[]): string[] {
  const folders = paths.map((path) => /^([^/]+)\/package\.json$/.exec(path)?.[1]);
  return folders.filter(
    (folder): folder is string => folder !== undefined && folder !== definitionsPackage,
  );
}

/** Each Contract Package `cf-loom package` writes for the project, by name, as the file of its entry. */
export function contractPackagesOf(paths: readonly string[]): [string, string][] {
  return servicesOf(paths).map((service) => [
    `@org/contract-${service}`,
    `${packageFolderOf(service)}/src/index.ts`,
  ]);
}

/**
 * Runs `cf-loom generate`, then `cf-loom package`, over each of the README Service's other
 * Services written to `directory`, as a Service of the organization does, each finding
 * `@org/definitions` as the Definitions Package the scope holds. What cf-loom refuses is kept in
 * `directory` for `cfLoomProblemsOf`, so the check reports it; a CLI not built throws.
 */
export function runCfLoom(directory: string, paths: readonly string[]): void {
  if (!existsSync(cli)) {
    throw new Error(`The README Service needs the CLI built: ${cli} is written by pnpm build`);
  }
  const refused = servicesOf(paths).flatMap((service) => generatedAndPackaged(directory, service));
  writeFileSync(join(directory, refusedAt), JSON.stringify(refused));
}

/** Runs `generate`, then `package` once `generate` refused nothing, and what either refused. */
function generatedAndPackaged(directory: string, service: string): CfLoomProblem[] {
  const folder = join(directory, service);
  linkDefinitions(folder);
  const generated = cfLoom(folder, ['generate'], service);
  if (generated.length > 0) {
    return generated;
  }
  return cfLoom(folder, ['package', '--out', join(directory, packageFolderOf(service))], service);
}

/** What cf-loom refused when the README Service was written to `directory`. */
export function cfLoomProblemsOf(directory: string): CfLoomProblem[] {
  const written = join(directory, refusedAt);
  return existsSync(written) ? JSON.parse(readFileSync(written, 'utf8')) : [];
}

function packageFolderOf(service: string): string {
  return `${packagesAt}/@org/contract-${service}`;
}

/** Installs the scope's Definitions Package in the Service, as a link, so its Root imports it by name. */
function linkDefinitions(service: string): void {
  const installed = join(service, 'node_modules', '@org');
  mkdirSync(installed, { recursive: true });
  symlinkSync(join('..', '..', '..', definitionsPackage), join(installed, 'definitions'));
}

/** Runs one command in the Service's folder, and what it refused, each line at the project file it names. */
function cfLoom(folder: string, command: readonly string[], service: string): CfLoomProblem[] {
  const ran = spawnSync(process.execPath, [cli, ...command], {
    cwd: folder,
    encoding: 'utf8',
    timeout: timeoutMs,
  });
  if (ran.error !== undefined) {
    const message = `cf-loom ${command[0]} did not finish: ${ran.error.message}`;
    return [{ path: undefined, row: 1, message: `${service}: ${message}` }];
  }
  if (ran.status === 0) {
    return [];
  }
  const lines = `${ran.stderr}${ran.stdout}`.split('\n').filter((line) => line !== '');
  return lines.map((line) => problemOf(line, service));
}

function problemOf(line: string, service: string): CfLoomProblem {
  const [, path, row, message] = cliLine.exec(line) ?? [];
  if (path === undefined || message === undefined) {
    return { path: undefined, row: 1, message: `${service}: ${line}` };
  }
  return { path: `${service}/${path}`, row: Number(row ?? 1), message };
}
