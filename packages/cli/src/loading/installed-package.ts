import { readFileSync } from 'node:fs';
import { findPackageJSON } from 'node:module';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

/** A package's version as installed where the root imports it, or why it has none. */
export type InstalledVersion =
  | { readonly kind: 'installed'; readonly version: string }
  | { readonly kind: 'failed'; readonly message: string };

/** Where a package is installed as the root file imports it, with its package.json, or why it is not. */
export type InstalledManifest =
  | {
      readonly kind: 'installed';
      readonly directory: string;
      readonly manifest: Readonly<Record<string, unknown>>;
    }
  | { readonly kind: 'failed'; readonly message: string };

/**
 * The version of a package as the root file imports it, such as a peer the Contract Package is
 * built with; nothing of it is loaded.
 */
export function installedVersionOf(packageName: string, rootPath: string): InstalledVersion {
  const found = foundOf(packageName, rootPath);
  if (found.kind !== 'found') {
    return { kind: 'failed', message: missingMessageOf(packageName, found) };
  }
  return { kind: 'installed', version: found.version };
}

/**
 * The folder and package.json of a package as the root file imports it, such as the TypeScript a
 * Contract Package is built with; nothing of it is loaded.
 */
export function installedManifestOf(packageName: string, rootPath: string): InstalledManifest {
  const found = foundOf(packageName, rootPath);
  if (found.kind !== 'found') {
    return { kind: 'failed', message: missingMessageOf(packageName, found) };
  }
  return { kind: 'installed', directory: dirname(found.manifestPath), manifest: found.manifest };
}

/** A package's package.json as found from the root file, with its version. */
type Found =
  | {
      readonly kind: 'found';
      readonly manifestPath: string;
      readonly manifest: Readonly<Record<string, unknown>>;
      readonly version: string;
    }
  | { readonly kind: 'not-installed' }
  | { readonly kind: 'no-version' };

/** Why a package cannot be used, in one line. */
function missingMessageOf(
  packageName: string,
  missing: Exclude<Found, { readonly kind: 'found' }>,
): string {
  return missing.kind === 'not-installed'
    ? `${packageName} is not installed`
    : `${packageName} has no version in its package.json`;
}

function foundOf(packageName: string, rootPath: string): Found {
  const manifestPath = manifestPathOf(packageName, rootPath);
  const manifest = manifestPath === undefined ? undefined : manifestIn(manifestPath);
  if (manifestPath === undefined || manifest === undefined) {
    return { kind: 'not-installed' };
  }
  const version = manifest['version'];
  if (typeof version !== 'string') {
    return { kind: 'no-version' };
  }
  return { kind: 'found', manifestPath, manifest, version };
}

/** Where Node finds the package's package.json from the root file, as the root imports it. */
function manifestPathOf(packageName: string, rootPath: string): string | undefined {
  try {
    return findPackageJSON(packageName, pathToFileURL(rootPath));
  } catch {
    return undefined;
  }
}

function manifestIn(path: string): Readonly<Record<string, unknown>> | undefined {
  try {
    const manifest: unknown = JSON.parse(readFileSync(path, 'utf8'));
    return typeof manifest === 'object' && manifest !== null ? { ...manifest } : undefined;
  } catch {
    return undefined;
  }
}
