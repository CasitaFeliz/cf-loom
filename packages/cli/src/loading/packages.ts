import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { listedDefinitionsOf, type ResolvedDefinitions } from '@casitafeliz/loom-contract/internal';

/** The Definitions Packages a root lists as installed, or the first that is not. */
export type ResolvedPackages =
  | { readonly kind: 'resolved'; readonly packages: readonly ResolvedDefinitions[] }
  | { readonly kind: 'failed'; readonly message: string };

/**
 * Resolves each Definitions Package a root lists to the package `<scope>/<name>` installed where
 * the project is, at its exact version, which the Snapshot records.
 */
export function resolvePackages(
  root: unknown,
  { directory, scope }: { readonly directory: string; readonly scope: string },
): ResolvedPackages {
  const packages: ResolvedDefinitions[] = [];
  for (const definitions of listedDefinitionsOf(root)) {
    const packageName = `${scope}/${definitions.name}`;
    const version = installedVersionOf(directory, packageName);
    if (version === undefined) {
      return { kind: 'failed', message: `${packageName} is not installed: install it to list it` };
    }
    packages.push({ definitions, packageName, version });
  }
  return { kind: 'resolved', packages };
}

/** The version of a package as Node resolves it from `directory`: the nearest `node_modules` holding it. */
function installedVersionOf(directory: string, packageName: string): string | undefined {
  const manifest = join(directory, 'node_modules', packageName, 'package.json');
  if (existsSync(manifest)) {
    return versionIn(manifest);
  }
  const parent = dirname(directory);
  return parent === directory ? undefined : installedVersionOf(parent, packageName);
}

/** A package.json that is no JSON or names no version installs no version anyone can record. */
function versionIn(manifest: string): string | undefined {
  try {
    const version: unknown = JSON.parse(readFileSync(manifest, 'utf8')).version;
    return typeof version === 'string' ? version : undefined;
  } catch {
    return undefined;
  }
}
