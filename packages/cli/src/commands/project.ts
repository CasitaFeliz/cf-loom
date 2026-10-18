import { join } from 'node:path';
import { loadConfig } from '../config/index.ts';
import {
  type InstalledDefinitions,
  loadRoot,
  type PackageName,
  projectPackageOf,
  resolvePackages,
} from '../loading/index.ts';
import { type Exit, toolingError } from './exit.ts';

/** A project as `generate` and `verify` read it: where it is, its package, its root and what the root lists. */
export type Project = {
  readonly directory: string;
  readonly packageName: PackageName;
  readonly root: unknown;
  /** Where the root file sits, relative to the project, as messages name it. */
  readonly rootFile: string;
  readonly packages: readonly InstalledDefinitions[];
};

/** A project read, or the tooling error that stopped reading it. */
export type ReadProject =
  | { readonly kind: 'read'; readonly project: Project }
  | { readonly kind: 'stopped'; readonly exit: Exit };

/**
 * Reads the project in `directory`: its package.json, its configuration, its root and the
 * Definitions Packages the root lists, as installed; each failure is a tooling error.
 */
export async function projectOf(directory: string): Promise<ReadProject> {
  const projectPackage = projectPackageOf(directory);
  if (projectPackage.kind === 'failed') {
    return stopped(projectPackage.message);
  }
  const config = await loadConfig(directory);
  if (config.kind === 'failed') {
    return stopped(config.message);
  }
  const loaded = await loadRoot(directory);
  if (loaded.kind === 'failed') {
    return stopped(loaded.message);
  }
  const rootPath = join(directory, loaded.file);
  const resolving = { rootPath, directory, scope: config.config.scope };
  const resolved = await resolvePackages(loaded.root, resolving);
  if (resolved.kind === 'failed') {
    return stopped(resolved.message);
  }
  const { packageName } = projectPackage;
  const { root, file: rootFile } = loaded;
  const project = { directory, packageName, root, rootFile, packages: resolved.packages };
  return { kind: 'read', project };
}

function stopped(message: string): ReadProject {
  return { kind: 'stopped', exit: toolingError(message) };
}
