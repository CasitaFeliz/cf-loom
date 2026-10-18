import { join } from 'node:path';
import type { ResolvedDefinitions } from '@casitafeliz/loom-contract/internal';
import { loadConfig } from '../config/index.ts';
import { loadRoot, type PackageName, projectPackageOf, resolvePackages } from '../loading/index.ts';
import { type Exit, toolingError } from './exit.ts';

/** A project as `generate` and `verify` read it: its package, its root and what the root lists. */
export type Project = {
  readonly packageName: PackageName;
  readonly root: unknown;
  /** Where the root file sits, relative to the project, as messages name it. */
  readonly rootFile: string;
  readonly packages: readonly ResolvedDefinitions[];
};

/** A project read, or the tooling error that stopped reading it. */
export type ReadProject =
  | { readonly kind: 'read'; readonly project: Project }
  | { readonly kind: 'stopped'; readonly exit: Exit };

/**
 * Reads the project in `cwd`: its package.json, its configuration, its root and the Definitions
 * Packages the root lists, as installed; each failure is a tooling error.
 */
export async function projectOf(cwd: string): Promise<ReadProject> {
  const projectPackage = projectPackageOf(cwd);
  if (projectPackage.kind === 'failed') {
    return stopped(projectPackage.message);
  }
  const config = await loadConfig(cwd);
  if (config.kind === 'failed') {
    return stopped(config.message);
  }
  const loaded = await loadRoot(cwd);
  if (loaded.kind === 'failed') {
    return stopped(loaded.message);
  }
  const rootPath = join(cwd, loaded.file);
  const resolved = resolvePackages(loaded.root, { rootPath, scope: config.config.scope });
  if (resolved.kind === 'failed') {
    return stopped(resolved.message);
  }
  const { packageName } = projectPackage;
  const project = {
    packageName,
    root: loaded.root,
    rootFile: loaded.file,
    packages: resolved.packages,
  };
  return { kind: 'read', project };
}

function stopped(message: string): ReadProject {
  return { kind: 'stopped', exit: toolingError(message) };
}
