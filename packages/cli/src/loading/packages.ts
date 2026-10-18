import { readFileSync } from 'node:fs';
import { findPackageJSON } from 'node:module';
import { pathToFileURL } from 'node:url';
import { listedDefinitionsOf, type ResolvedDefinitions } from '@casitafeliz/loom-contract/internal';

/** The Definitions Packages a root lists as installed, or the first that is not. */
export type ResolvedPackages =
  | { readonly kind: 'resolved'; readonly packages: readonly ResolvedDefinitions[] }
  | { readonly kind: 'failed'; readonly message: string };

/** What a listed Definitions Package is resolved from: the root file and the configured scope. */
export type Resolving = { readonly rootFile: string; readonly scope: string };

/**
 * Resolves each Definitions Package a root lists to the package `<scope>/<name>` as the root
 * file imports it, at its exact version, which the Snapshot records.
 */
export function resolvePackages(root: unknown, { rootFile, scope }: Resolving): ResolvedPackages {
  const packages: ResolvedDefinitions[] = [];
  for (const definitions of listedDefinitionsOf(root)) {
    const packageName = `${scope}/${definitions.name}`;
    const version = installedVersionOf(packageName, rootFile);
    if (version.kind === 'failed') {
      return version;
    }
    packages.push({ definitions, packageName, version: version.version });
  }
  return { kind: 'resolved', packages };
}

function installedVersionOf(
  packageName: string,
  rootFile: string,
):
  | { readonly kind: 'installed'; readonly version: string }
  | Extract<ResolvedPackages, { readonly kind: 'failed' }> {
  const manifest = manifestPathOf(packageName, rootFile);
  if (manifest === undefined) {
    return { kind: 'failed', message: `${packageName} is not installed: install it to list it` };
  }
  const version = versionIn(manifest);
  if (version === undefined) {
    return { kind: 'failed', message: `${packageName} has no version in its package.json` };
  }
  return { kind: 'installed', version };
}

/** Where Node finds the package's package.json from the root file, as the root imports it. */
function manifestPathOf(packageName: string, rootFile: string): string | undefined {
  try {
    return findPackageJSON(packageName, pathToFileURL(rootFile));
  } catch {
    return undefined;
  }
}

function versionIn(manifest: string): string | undefined {
  try {
    const version: unknown = JSON.parse(readFileSync(manifest, 'utf8')).version;
    return typeof version === 'string' ? version : undefined;
  } catch {
    return undefined;
  }
}
