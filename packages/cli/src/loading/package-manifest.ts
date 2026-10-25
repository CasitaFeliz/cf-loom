import { readFileSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import type { PackageIdentity } from '@cf-loom/contract/internal';

/** A package.json as read: where it is, its fields, and its name and version when it gives them. */
export type PackageManifest = {
  readonly path: string;
  readonly fields: Readonly<Record<string, unknown>>;
  readonly name: string | undefined;
  readonly version: string | undefined;
};

/** The package.json at `path`, or nothing when there is none or it is no JSON object. */
export function packageManifestAt(path: string): PackageManifest | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (typeof parsed !== 'object' || parsed === null) {
      return undefined;
    }
    const fields: Readonly<Record<string, unknown>> = { ...parsed };
    const { name, version } = fields;
    return {
      path,
      fields,
      name: typeof name === 'string' ? name : undefined,
      version: typeof version === 'string' ? version : undefined,
    };
  } catch {
    return undefined;
  }
}

/**
 * The package.json of the package a file belongs to: the first, up from the file, that names a
 * package or sits at a package's folder under `node_modules`, so a nested one that only sets a
 * module type, such as `dist/package.json`, is not taken for the package.
 */
export function packageRootManifestOf(file: string): PackageManifest | undefined {
  let directory = dirname(file);
  for (;;) {
    const manifest = packageManifestAt(join(directory, 'package.json'));
    if (manifest !== undefined && (manifest.name !== undefined || isInstalledFolder(directory))) {
      return manifest;
    }
    const parent = dirname(directory);
    if (parent === directory) {
      return undefined;
    }
    directory = parent;
  }
}

/** A package's identity from its package.json, the path of one with no name relative to the project. */
export function packageIdentityOf(manifest: PackageManifest, directory: string): PackageIdentity {
  const { name, version, path } = manifest;
  if (name === undefined) {
    return { kind: 'unnamed', manifest: relative(directory, path) };
  }
  if (version === undefined) {
    return { kind: 'unversioned', packageName: name };
  }
  return { kind: 'identified', packageName: name, version };
}

/** Whether a folder is a package's own folder under `node_modules`, scoped or not. */
function isInstalledFolder(directory: string): boolean {
  const parent = dirname(directory);
  if (basename(parent) === 'node_modules') {
    return true;
  }
  return basename(parent).startsWith('@') && basename(dirname(parent)) === 'node_modules';
}
