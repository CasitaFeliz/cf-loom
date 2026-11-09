import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, relative } from 'node:path';
import { type Compiled, compile, describe, timeoutMs } from './readme-compile.ts';

/**
 * What stopped one of the README Service's Services, as `<step>: <package name>: <message>`: a
 * refusal of cf-loom, or the failed build of its Contract Package. It names a file of the
 * written-out Service and its line, when it can.
 */
export type CfLoomProblem = {
  readonly path: string | undefined;
  readonly row: number;
  readonly message: string;
};

/** A Service of the README Service: the folder it sits in, `.` for the README's own, where it is written, and its package's name. */
type Service = { readonly folder: string; readonly at: string; readonly name: string };

/** A command run over a Service, named as its lines say: `cf-loom generate`. */
type Step = { readonly name: string; readonly args: readonly string[] };

const cli = join(import.meta.dirname, '..', 'packages', 'cli', 'dist', 'bin.js');
const refusedAt = 'cf-loom-refused.json';
const definitionsPackage = 'definitions';
const contractPackageAt = '.cf-loom/contract-package';
const generate: Step = { name: 'cf-loom generate', args: ['generate'] };
const pack: Step = { name: 'cf-loom package', args: ['package', '--out', contractPackageAt] };
const build = `tsc -p ${contractPackageAt}`;
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
  return all.map((folder) => {
    const at = join(directory, folder);
    return { folder, at, name: packageNameOf(at) };
  });
}

/**
 * Runs `cf-loom generate`, then `cf-loom package` and a build of its package, over each of the
 * README Service's Services written to `directory`, as a Service of the organization does, each
 * finding the Definitions Package and the Contract Packages the others wrote in `node_modules`. A
 * Service runs whatever another was refused: one that consumes a package that is missing is
 * refused by cf-loom itself. What stopped each is kept in `directory` for `cfLoomProblemsOf`, so
 * the check reports it; a CLI not built throws.
 */
export function runCfLoom(
  directory: string,
  paths: readonly string[],
  program: string = cli,
): void {
  if (!existsSync(program)) {
    throw new Error(`The README Service needs the CLI built: ${program} is written by pnpm build`);
  }
  if (paths.includes(`${definitionsPackage}/package.json`)) {
    installPackage(directory, join(directory, definitionsPackage));
  }
  const stopped = servicesOf(directory, paths).flatMap((service) =>
    runOver(directory, service, program),
  );
  writeFileSync(join(directory, refusedAt), JSON.stringify(stopped));
}

/** What stopped the README Service's Services when it was written to `directory`. */
export function cfLoomProblemsOf(directory: string): CfLoomProblem[] {
  const written = join(directory, refusedAt);
  return existsSync(written) ? JSON.parse(readFileSync(written, 'utf8')) : [];
}

/** Runs `generate`, `package` and the build, each once the one before stopped nothing, then installs the package. */
function runOver(directory: string, service: Service, program: string): CfLoomProblem[] {
  for (const step of [generate, pack]) {
    const refused = run(step, service, program);
    if (refused.length > 0) {
      return refused;
    }
  }
  const packageFolder = join(service.at, contractPackageAt);
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
  const located = built.diagnostics.map((diagnostic): CfLoomProblem => {
    const { path, row } = diagnostic;
    const inService =
      path === undefined ? undefined : posix.join(service.folder, contractPackageAt, path);
    return { path: inService, row, message: stoppedBy(build, service, describe(diagnostic)) };
  });
  const unplaced = { path: undefined, row: 1, message: stoppedBy(build, service, built.output) };
  return located.length > 0 ? located : [unplaced];
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

/** Runs the CLI over a Service, and what it refused, each line at the project file it names. */
function run(step: Step, service: Service, program: string): CfLoomProblem[] {
  const ran = spawnSync(process.execPath, [program, ...step.args], {
    cwd: service.at,
    encoding: 'utf8',
    timeout: timeoutMs,
  });
  if (ran.error !== undefined) {
    const message = stoppedBy(step.name, service, `did not finish: ${ran.error.message}`);
    return [{ path: undefined, row: 1, message }];
  }
  if (ran.status === 0) {
    return [];
  }
  const lines = `${ran.stderr}${ran.stdout}`.split('\n').filter((line) => line !== '');
  if (lines.length === 0) {
    const message = stoppedBy(
      step.name,
      service,
      `exited ${ran.status ?? ran.signal} with no output`,
    );
    return [{ path: undefined, row: 1, message }];
  }
  return lines.map((line) => problemOf(line, step, service));
}

function problemOf(line: string, step: Step, service: Service): CfLoomProblem {
  const [, path, row, message] = cliLine.exec(line) ?? [];
  if (path === undefined || message === undefined) {
    return { path: undefined, row: 1, message: stoppedBy(step.name, service, line) };
  }
  return {
    path: posix.join(service.folder, path),
    row: Number(row ?? 1),
    message: stoppedBy(step.name, service, message),
  };
}

/** A line that stops a Service: the step, the Service's package and what happened. */
function stoppedBy(step: string, service: Service, message: string): string {
  return `${step}: ${service.name}: ${message}`;
}
