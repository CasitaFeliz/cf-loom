import { ownOf } from '@cf-loom/contract/internal';
import { type Failed, failed } from '../child-process/index.ts';
import type { DistTag } from '../versioning/index.ts';
import { jsonFromNpm, type NpmPlace, packedOf } from './npm.ts';
import { packedTarballOf, publishedSnapshotIn } from './published-tarball.ts';
import type { ExpectedSnapshot } from './versions.ts';

/** A staged folder to pack, the folder its tarball goes in, and the Snapshot the tarball must hold. */
export type Packing = {
  readonly folder: string;
  readonly into: string;
  readonly expected: ExpectedSnapshot;
};

/** A tarball to publish as a package's version, called by its spec, and the dist-tag it takes. */
export type Publishing = {
  readonly file: string;
  readonly spec: string;
  readonly tag: DistTag;
};

/**
 * Packs a staged folder into the one tarball that will be published and reads it as `check` will
 * read the version from the registry, so that a package `check` cannot read is never published.
 */
export async function packedForPublish(
  npm: NpmPlace,
  { folder, into, expected }: Packing,
): Promise<{ readonly kind: 'packed'; readonly file: string } | Failed> {
  const packed = await packedTarballOf(npm, { spec: expected.spec, target: folder }, into);
  if (packed.kind === 'failed') {
    return packed;
  }
  const read = publishedSnapshotIn(packed.bytes, expected);
  return read.kind === 'failed' ? read : { kind: 'packed', file: packed.file };
}

/**
 * Publishes a tarball through the organization's npm, in the project's directory, with no
 * lifecycle script, and never naming a registry: where it goes is the organization's npm
 * configuration, and the `publishConfig` in the tarball's package.json.
 */
export async function publishTarball(
  npm: NpmPlace,
  { file, spec, tag }: Publishing,
): Promise<{ readonly kind: 'published' } | Failed> {
  const label = `npm publish ${spec}`;
  const args = ['publish', file, '--tag', tag, '--ignore-scripts'];
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

/**
 * The paths `npm pack --dry-run` lists for the project's own package, with no lifecycle script:
 * npm is given the project's directory, which it packs alone whatever its workspace settings.
 */
export async function packedPathsOf(
  npm: NpmPlace,
): Promise<{ readonly kind: 'paths'; readonly paths: readonly string[] } | Failed> {
  const label = 'npm pack --dry-run';
  const args = ['pack', npm.directory, '--dry-run', '--ignore-scripts'];
  const run = await jsonFromNpm(npm, { label, args });
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
  const files = ownOf(packedOf(printed), 'files');
  const paths = Array.isArray(files) ? files.map((file) => ownOf(file, 'path')) : [];
  if (paths.length === 0 || !paths.every(isPath)) {
    return failed(`${label} listed no files`);
  }
  return { kind: 'paths', paths };
}

function isPath(path: unknown): path is string {
  return typeof path === 'string' && path !== '';
}
