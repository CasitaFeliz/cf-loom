import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, relative } from 'node:path';
import { type Compiled, compile, describe, timeoutMs } from './readme-compile.ts';

/**
 * What stopped one of the README Service's Services: a refusal of cf-loom, or the failed build of
 * its Contract Package. It names a file of the written-out Service and its line, when it can.
 */
export type CfLoomProblem = {
  readonly path: string | undefined;
  readonly row: number;
  readonly message: string;
};

/** A Service of the README Service: the folder it sits in, `.` for the README's own, and its package's name. */
type Service = { readonly folder: string; readonly name: string };

const cli = join(import.meta.dirname, '..', 'packages', 'cli', 'dist', 'bin.js');
const refusedAt = 'cf-loom-refused.json';
const definitionsPackage = 'definitions';
const contractPackageAt = '.cf-loom/contract-package';
const cliLine = /^(src\/\S+?\.ts)(?::(\d+))?:? (.*)$/;

/**
 * The README Service's Services in the order cf-loom runs over them: each folder the scope gives a
 * `package.json`, but the Definitions Package's, then the README's own Service, which runs last
 * because it consumes the Contract Package of `payments-service`.
 */
function servicesOf(directory: string, paths: readonly string[]): Service[] {
  const folders = paths.map((path) => /^([^/]+)\/package\.json$/.exec(path)?.[1]);
  const others = folders.filter(
    (folder): folder is string => folder !== undefined && folder !== definitionsPackage,
  );
  const all = paths.includes('package.json') ? [...others, '.'] : others;
  return all.map((folder) => ({ folder, name: packageNameOf(join(directory, folder)) }));
}

/**
 * Runs `cf-loom generate`, then `cf-loom package` and a build of its package, over each of the
 * README Service's Services written to `directory`, as a Service of the organization does, each
 * finding the Definitions Package and the Contract Packages the others wrote in `node_modules`.
 * It stops at the first Service cf-loom refuses. What stopped it is kept in `directory` for
 * `cfLoomProblemsOf`, so the check reports it; a CLI not built throws.
 */
export function runCfLoom(directory: string, paths: readonly string[]): void {
  if (!existsSync(cli)) {
    throw new Error(`The README Service needs the CLI built: ${cli} is written by pnpm build`);
  }
  if (paths.includes(`${definitionsPackage}/package.json`)) {
    installPackage(directory, join(directory, definitionsPackage));
  }
  const stopped = runServices(directory, servicesOf(directory, paths));
  writeFileSync(join(directory, refusedAt), JSON.stringify(stopped));
}

/** What stopped the README Service's Services when it was written to `directory`. */
export function cfLoomProblemsOf(directory: string): CfLoomProblem[] {
  const written = join(directory, refusedAt);
  return existsSync(written) ? JSON.parse(readFileSync(written, 'utf8')) : [];
}

/** Runs the Services in order up to the first that is refused, and says which of the later ones were not run. */
function runServices(directory: string, services: readonly Service[]): CfLoomProblem[] {
  for (const [index, service] of services.entries()) {
    const refused = runOver(directory, service);
    if (refused.length > 0) {
      const later = services.slice(index + 1);
      return [...refused, ...later.map((notRun) => notRunBecause(notRun, service))];
    }
  }
  return [];
}

function notRunBecause(notRun: Service, refused: Service): CfLoomProblem {
  const message = `cf-loom: ${notRun.name}: not run: ${refused.name} was refused`;
  return { path: undefined, row: 1, message };
}

/** Runs `generate`, `package` and the build, each once the one before stopped nothing, then installs the package. */
function runOver(directory: string, service: Service): CfLoomProblem[] {
  const folder = join(directory, service.folder);
  for (const args of [['generate'], ['package', '--out', contractPackageAt]]) {
    const refused = run(args, folder, service);
    if (refused.length > 0) {
      return refused;
    }
  }
  const packageFolder = join(folder, contractPackageAt);
  const failed = buildProblemsOf(compile(packageFolder), service);
  if (failed.length === 0) {
    installPackage(directory, packageFolder);
  }
  return failed;
}

/** The diagnostics of the build of a Contract Package, each at its file under the package's folder. */
function buildProblemsOf(built: Compiled, service: Service): CfLoomProblem[] {
  if (!built.failed) {
    return [];
  }
  const build = `building the Contract Package of ${service.name}`;
  const located = built.diagnostics.map((diagnostic): CfLoomProblem => {
    const path = diagnostic.path;
    const inService =
      path === undefined ? undefined : posix.join(service.folder, contractPackageAt, path);
    return { path: inService, row: diagnostic.row, message: `${build}: ${describe(diagnostic)}` };
  });
  return located.length > 0
    ? located
    : [{ path: undefined, row: 1, message: `${build}: ${built.output}` }];
}

/** The name in the package.json of the package in `folder`. */
function packageNameOf(folder: string): string {
  const manifest = join(folder, 'package.json');
  const { name }: { name?: unknown } = JSON.parse(readFileSync(manifest, 'utf8'));
  if (typeof name !== 'string') {
    throw new Error(`${manifest} names no package`);
  }
  return name;
}

/** Installs the package in `folder` in the `node_modules` of `directory`, as a link under its name. */
function installPackage(directory: string, folder: string): void {
  const link = join(directory, 'node_modules', packageNameOf(folder));
  mkdirSync(dirname(link), { recursive: true });
  symlinkSync(relative(dirname(link), folder), link);
}

/** Runs the CLI in a folder, and what it refused, each line at the project file it names. */
function run(args: readonly string[], folder: string, service: Service): CfLoomProblem[] {
  const command = `cf-loom ${args[0]}`;
  const ran = spawnSync(process.execPath, [cli, ...args], {
    cwd: folder,
    encoding: 'utf8',
    timeout: timeoutMs,
  });
  if (ran.error !== undefined) {
    const message = `${command}: ${service.name}: did not finish: ${ran.error.message}`;
    return [{ path: undefined, row: 1, message }];
  }
  if (ran.status === 0) {
    return [];
  }
  const lines = `${ran.stderr}${ran.stdout}`.split('\n').filter((line) => line !== '');
  return lines.map((line) => problemOf(line, command, service));
}

function problemOf(line: string, command: string, service: Service): CfLoomProblem {
  const [, path, row, message] = cliLine.exec(line) ?? [];
  if (path === undefined || message === undefined) {
    return { path: undefined, row: 1, message: `${command}: ${service.name}: ${line}` };
  }
  return { path: posix.join(service.folder, path), row: Number(row ?? 1), message };
}
