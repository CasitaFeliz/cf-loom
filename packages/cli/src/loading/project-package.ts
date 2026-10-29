import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type PackageNameParts, packageNamePartsOf } from '@cf-loom/contract/internal';
import { oneLineOf } from './imported.ts';

/** A project's package as its package.json names it: the scope, when it has one, and the name. */
export type PackageName = PackageNameParts;

/** A package's name as its package.json writes it, scope included. */
export function packageJsonNameOf({ scope, name }: PackageName): string {
  return scope === undefined ? name : `${scope}/${name}`;
}

/** The project's package with its package.json as read, or why its package.json cannot be used. */
export type ProjectPackage =
  | {
      readonly kind: 'read';
      readonly packageName: PackageName;
      readonly manifest: Readonly<Record<string, unknown>>;
    }
  | { readonly kind: 'failed'; readonly message: string };

/** A package name npm accepts: lower-case, scoped or not, never a scope alone. */
const packageNamePattern = /^(@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/;

/** Whether `name` is a package name npm accepts for a new package: lower-case, scoped or not, never a scope alone. */
export function isPackageName(name: string): boolean {
  return packageNamePattern.test(name);
}

/**
 * Reads the package.json of the project in `directory`: its name, which the Root's name and the
 * published package's name come from, and its `"type": "module"`, since the config and the
 * Contract's files are ES modules.
 */
export function projectPackageOf(directory: string): ProjectPackage {
  const path = join(directory, 'package.json');
  if (!existsSync(path)) {
    return failed('package.json not found: cf-loom runs next to the package.json of the project');
  }
  const manifest = manifestOf(path, directory);
  if (manifest.kind === 'failed') {
    return manifest;
  }
  const { name, type } = manifest.manifest;
  if (typeof name !== 'string') {
    return failed('package.json names no package');
  }
  if (!isPackageName(name)) {
    return failed(`package.json names no package npm accepts: ${name}`);
  }
  if (type !== 'module') {
    return failed(
      'package.json has no "type": "module": the config and the Contract\'s files are ES modules',
    );
  }
  const packageName = packageNamePartsOf(name);
  return { kind: 'read', packageName, manifest: manifest.manifest };
}

function manifestOf(
  path: string,
  directory: string,
):
  | { readonly kind: 'parsed'; readonly manifest: Readonly<Record<string, unknown>> }
  | Extract<ProjectPackage, { readonly kind: 'failed' }> {
  try {
    const manifest: unknown = JSON.parse(readFileSync(path, 'utf8'));
    return {
      kind: 'parsed',
      manifest: typeof manifest === 'object' && manifest !== null ? { ...manifest } : {},
    };
  } catch (e) {
    const problem = e instanceof SyntaxError ? 'is no JSON' : 'cannot be read';
    return failed(`package.json ${problem}: ${oneLineOf(e, directory)}`);
  }
}

function failed(message: string): Extract<ProjectPackage, { readonly kind: 'failed' }> {
  return { kind: 'failed', message };
}
