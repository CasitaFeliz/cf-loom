import { findPackageJSON } from 'node:module';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { noVersionLineOf } from '@cf-loom/contract/internal';
import { packageManifestAt } from './package-manifest.ts';

/** A package's version as installed where the Root imports it, or why it has none. */
export type InstalledVersion =
  | { readonly kind: 'installed'; readonly version: string }
  | { readonly kind: 'failed'; readonly message: string };

/** Where a package is installed as the Root file imports it, with its package.json, or why it is not. */
export type InstalledManifest =
  | {
      readonly kind: 'installed';
      readonly directory: string;
      readonly manifest: Readonly<Record<string, unknown>>;
    }
  | { readonly kind: 'failed'; readonly message: string };

/**
 * The version of a package as the Root file imports it, such as a peer the Contract Package is
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
 * The folder and package.json of a package as the Root file imports it, such as the TypeScript a
 * Contract Package is built with; nothing of it is loaded.
 */
export function installedManifestOf(packageName: string, rootPath: string): InstalledManifest {
  const found = foundOf(packageName, rootPath);
  if (found.kind !== 'found') {
    return { kind: 'failed', message: missingMessageOf(packageName, found) };
  }
  return { kind: 'installed', directory: dirname(found.manifestPath), manifest: found.manifest };
}

/** A package's package.json as found from the Root file, with its version. */
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
    : noVersionLineOf(packageName);
}

function foundOf(packageName: string, rootPath: string): Found {
  const manifestPath = manifestPathOf(packageName, rootPath);
  const manifest = manifestPath === undefined ? undefined : packageManifestAt(manifestPath);
  if (manifestPath === undefined || manifest === undefined) {
    return { kind: 'not-installed' };
  }
  const { version, fields } = manifest;
  if (version === undefined) {
    return { kind: 'no-version' };
  }
  return { kind: 'found', manifestPath, manifest: fields, version };
}

/** Where Node finds the package's package.json from the Root file, as the Root imports it. */
function manifestPathOf(packageName: string, rootPath: string): string | undefined {
  try {
    return findPackageJSON(packageName, pathToFileURL(rootPath));
  } catch {
    return undefined;
  }
}
