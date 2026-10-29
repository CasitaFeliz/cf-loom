import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { packagesAt } from './readme-project.ts';

/** The README Service's other Services, whose Handler map and Readers file `cf-loom generate` writes. */
const generatedServices = ['notes-service', 'payments-service'];

/** The Services whose Contract Package a file of the README Service imports, which `cf-loom package` writes. */
const packagedServices = ['payments-service'];

/** Each Contract Package `cf-loom package` writes for the project, by name, as the file of its entry. */
export function contractPackagesOf(paths: readonly string[]): [string, string][] {
  return packagedServices
    .filter((service) => paths.includes(packageJsonOf(service)))
    .map((service) => [`@org/contract-${service}`, `${packageFolderOf(service)}/src/index.ts`]);
}

/**
 * Runs `cf-loom generate` over each of the README Service's other Services written to `directory`,
 * then `cf-loom package` over those whose Contract Package another file imports, as a Service of
 * the organization does. Each finds `@org/definitions` as the Definitions Package the scope holds.
 */
export function runCfLoom(directory: string, paths: readonly string[], repository: string): void {
  const services = generatedServices.filter((service) => paths.includes(packageJsonOf(service)));
  for (const service of services) {
    linkDefinitions(join(directory, service));
    cfLoom(join(directory, service), repository, ['generate']);
  }
  for (const service of packagedServices.filter((packaged) => services.includes(packaged))) {
    const out = join(directory, packageFolderOf(service));
    cfLoom(join(directory, service), repository, ['package', '--out', out]);
  }
}

/** A Service the scope gives its package.json, so cf-loom can name it as it names any Service. */
function packageJsonOf(service: string): string {
  return `${service}/package.json`;
}

function packageFolderOf(service: string): string {
  return `${packagesAt}/@org/contract-${service}`;
}

/** Installs the scope's Definitions Package in the Service, as a link, so its Root imports it by name. */
function linkDefinitions(service: string): void {
  const installed = join(service, 'node_modules', '@org');
  mkdirSync(installed, { recursive: true });
  symlinkSync(join('..', '..', '..', 'definitions'), join(installed, 'definitions'));
}

function cfLoom(service: string, repository: string, command: readonly string[]): void {
  const cli = join(repository, 'packages', 'cli', 'dist', 'bin.js');
  if (!existsSync(cli)) {
    throw new Error(`The README Service needs the CLI built: ${cli} is written by pnpm build`);
  }
  const ran = spawnSync(process.execPath, [cli, ...command], { cwd: service, encoding: 'utf8' });
  if (ran.error) {
    throw ran.error;
  }
  if (ran.status !== 0) {
    throw new Error(`cf-loom ${command.join(' ')} failed in ${service}:\n${ran.stderr}`);
  }
}
