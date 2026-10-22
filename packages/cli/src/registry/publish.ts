import { ownOf } from '@cf-loom/contract/internal';
import { type Failed, failed, jsonFromNpm, type NpmPlace } from './npm.ts';

/** The dist-tag a version is published under. */
export type DistTag = 'latest' | 'next';

/** A staged folder to publish as a package's version, and the dist-tag it takes. */
export type Publishing = {
  readonly folder: string;
  readonly packageName: string;
  readonly version: string;
  readonly tag: DistTag;
};

/**
 * Publishes a folder through the organization's npm, in the project's directory, with no
 * lifecycle script, and never naming a registry: where it goes is the organization's npm
 * configuration.
 */
export async function publishFolder(
  npm: NpmPlace,
  { folder, packageName, version, tag }: Publishing,
): Promise<{ readonly kind: 'published' } | Failed> {
  const label = `npm publish ${packageName}@${version}`;
  const args = ['publish', folder, '--tag', tag, '--ignore-scripts'];
  const run = await jsonFromNpm(npm, { label, args });
  switch (run.kind) {
    case 'json':
      return { kind: 'published' };
    case 'refused':
      return failed(run.message);
    case 'failed':
      return run;
  }
}

/** The paths `npm pack --dry-run` lists for the project's own package, with no lifecycle script. */
export async function packedPathsOf(
  npm: NpmPlace,
): Promise<{ readonly kind: 'paths'; readonly paths: readonly string[] } | Failed> {
  const label = 'npm pack --dry-run';
  const run = await jsonFromNpm(npm, { label, args: ['pack', '--dry-run', '--ignore-scripts'] });
  switch (run.kind) {
    case 'json':
      return pathsFrom(label, run.value);
    case 'refused':
      return failed(run.message);
    case 'failed':
      return run;
  }
}

function pathsFrom(
  label: string,
  printed: unknown,
): { readonly kind: 'paths'; readonly paths: readonly string[] } | Failed {
  const [packed] = Array.isArray(printed) ? printed : [];
  const files = ownOf(packed, 'files');
  const paths = Array.isArray(files) ? files.map((file) => ownOf(file, 'path')) : [];
  if (paths.length === 0 || !paths.every(isPath)) {
    return failed(`${label} listed no files`);
  }
  return { kind: 'paths', paths };
}

function isPath(path: unknown): path is string {
  return typeof path === 'string' && path !== '';
}
