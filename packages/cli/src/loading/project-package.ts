import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** A project's package as its package.json names it: the scope, when it has one, and the name. */
export type PackageName = { readonly scope: string | undefined; readonly name: string };

/** The project's package, or why its package.json cannot be used. */
export type ProjectPackage =
  | { readonly kind: 'read'; readonly packageName: PackageName }
  | { readonly kind: 'failed'; readonly message: string };

/** A package name npm accepts: lower-case, scoped or not, never a scope alone. */
const packageNamePattern = /^(@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/;

/**
 * Reads the package.json of the project in `directory`: its name, which the root's name and the
 * configuration's scope come from, and its `"type": "module"`, since the config and the
 * Contract's files are ES modules.
 */
export function projectPackageOf(directory: string): ProjectPackage {
  const path = join(directory, 'package.json');
  if (!existsSync(path)) {
    return failed('package.json not found: cf-loom runs next to the package.json of the project');
  }
  const manifest = manifestOf(readFileSync(path, 'utf8'));
  if (manifest.kind === 'failed') {
    return manifest;
  }
  const { name, type } = manifest.manifest;
  if (typeof name !== 'string') {
    return failed('package.json names no package');
  }
  if (!packageNamePattern.test(name)) {
    return failed(`package.json names no package npm accepts: ${name}`);
  }
  if (type !== 'module') {
    return failed(
      'package.json has no "type": "module": the config and the Contract\'s files are ES modules',
    );
  }
  const [scope, unscoped] = name.startsWith('@') ? name.split('/') : [undefined, name];
  return { kind: 'read', packageName: { scope, name: unscoped ?? name } };
}

function manifestOf(text: string):
  | {
      readonly kind: 'parsed';
      readonly manifest: { readonly name?: unknown; readonly type?: unknown };
    }
  | Extract<ProjectPackage, { readonly kind: 'failed' }> {
  try {
    const manifest: unknown = JSON.parse(text);
    return {
      kind: 'parsed',
      manifest: typeof manifest === 'object' && manifest !== null ? manifest : {},
    };
  } catch (e) {
    const reason = e instanceof Error ? e.message.split('\n', 1)[0] : String(e);
    return failed(`package.json is no JSON: ${reason}`);
  }
}

function failed(message: string): Extract<ProjectPackage, { readonly kind: 'failed' }> {
  return { kind: 'failed', message };
}
