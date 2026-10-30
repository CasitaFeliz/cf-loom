import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, relative } from 'node:path';
import { tsc } from './readme-compile.ts';

/** What cf-loom refused in one of the README Service's Services: a file of the project and its line, when it names one. */
export type CfLoomProblem = {
  readonly path: string | undefined;
  readonly row: number;
  readonly message: string;
};

/** A program run in a folder: the script Node runs, its arguments and its name in a refusal. */
type Command = { readonly name: string; readonly script: string; readonly args: readonly string[] };

const cli = join(import.meta.dirname, '..', 'packages', 'cli', 'dist', 'bin.js');
const generate: Command = { name: 'cf-loom generate', script: cli, args: ['generate'] };
const pack: Command = { name: 'cf-loom package', script: cli, args: ['package'] };
const build: Command = { name: 'tsc', script: tsc, args: ['-p', '.', '--pretty', 'false'] };
const refusedAt = 'cf-loom-refused.json';
const definitionsPackage = 'definitions';
/** Where `cf-loom package` writes a Contract Package unless it is given a folder. */
const contractPackageAt = join('.cf-loom', 'contract-package');
const ownService = "the README's own Service";
/** Long enough for a slow runner, short enough that a hung command fails the write-out. */
const timeoutMs = 60_000;
const cliLine = /^(src\/\S+?\.ts)(?::(\d+))?:? (.*)$/;

/**
 * The folders of the README Service's Services in the order cf-loom runs over them: each folder
 * the scope gives a `package.json`, but the Definitions Package's, then the README's own Service
 * at the root, the one Consumer of the others' Contract Packages.
 */
function servicesOf(paths: readonly string[]): string[] {
  const folders = paths.map((path) => /^([^/]+)\/package\.json$/.exec(path)?.[1]);
  const others = folders.filter(
    (folder): folder is string => folder !== undefined && folder !== definitionsPackage,
  );
  return paths.includes('package.json') ? [...others, ''] : others;
}

/**
 * Runs `cf-loom generate`, then `cf-loom package` and a build of its package, over each of the
 * README Service's Services written to `directory`, as a Service of the organization does, each
 * finding the Definitions Package and the Contract Packages the others wrote in `node_modules`.
 * What cf-loom refuses is kept in `directory` for `cfLoomProblemsOf`, so the check reports it; a
 * CLI not built throws.
 */
export function runCfLoom(directory: string, paths: readonly string[]): void {
  if (!existsSync(cli)) {
    throw new Error(`The README Service needs the CLI built: ${cli} is written by pnpm build`);
  }
  if (paths.includes(`${definitionsPackage}/package.json`)) {
    installPackage(directory, join(directory, definitionsPackage));
  }
  const refused = servicesOf(paths).flatMap((service) => runOver(directory, service));
  writeFileSync(join(directory, refusedAt), JSON.stringify(refused));
}

/** What cf-loom refused when the README Service was written to `directory`. */
export function cfLoomProblemsOf(directory: string): CfLoomProblem[] {
  const written = join(directory, refusedAt);
  return existsSync(written) ? JSON.parse(readFileSync(written, 'utf8')) : [];
}

/** Runs `generate`, `package` and the build, each once the one before refused nothing, then installs the package. */
function runOver(directory: string, service: string): CfLoomProblem[] {
  const folder = join(directory, service);
  const packageFolder = join(folder, contractPackageAt);
  const steps: [Command, string][] = [
    [generate, folder],
    [pack, folder],
    [build, packageFolder],
  ];
  for (const [command, cwd] of steps) {
    const refused = run(command, cwd, service);
    if (refused.length > 0) {
      return refused;
    }
  }
  installPackage(directory, packageFolder);
  return [];
}

/** Installs the package in `folder` in the `node_modules` of `directory`, as a link under the name its package.json gives. */
function installPackage(directory: string, folder: string): void {
  const manifest = join(folder, 'package.json');
  const { name }: { name?: unknown } = JSON.parse(readFileSync(manifest, 'utf8'));
  if (typeof name !== 'string') {
    throw new Error(`${manifest} names no package`);
  }
  const link = join(directory, 'node_modules', name);
  mkdirSync(dirname(link), { recursive: true });
  symlinkSync(relative(dirname(link), folder), link);
}

/** Runs one command in a folder, and what it refused, each line at the project file it names. */
function run(command: Command, folder: string, service: string): CfLoomProblem[] {
  const ran = spawnSync(process.execPath, [command.script, ...command.args], {
    cwd: folder,
    encoding: 'utf8',
    timeout: timeoutMs,
  });
  if (ran.error !== undefined) {
    const message = `${command.name} did not finish: ${ran.error.message}`;
    return [{ path: undefined, row: 1, message: `${labelOf(service)}: ${message}` }];
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
    return { path: undefined, row: 1, message: `${labelOf(service)}: ${line}` };
  }
  return { path: posix.join(service, path), row: Number(row ?? 1), message };
}

/** The name a refusal gives a Service: its folder, or the README's own Service at the root. */
function labelOf(service: string): string {
  return service === '' ? ownService : service;
}
