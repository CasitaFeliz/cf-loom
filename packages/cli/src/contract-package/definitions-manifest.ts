import type { PublishedDefinitionsSnapshot } from '@cf-loom/contract/internal';
import { cfLoomOf, manifestFileOf, type Packaging, peerRangesOf } from './manifest.ts';
import type { PackageFile } from './modules.ts';
import { packagePaths } from './paths.ts';

/** A Definitions Package's package.json as published, or the line saying why it cannot be. */
export type DefinitionsManifest =
  | { readonly kind: 'manifest'; readonly file: PackageFile }
  | { readonly kind: 'unpublishable'; readonly line: string };

/** The fields of a package.json whose dependencies npm installs with the package. */
const installedFields = ['dependencies', 'optionalDependencies'] as const;

/** The ranges npm publishes unchanged and no registry can install. */
const uninstallableRange = /^(workspace|catalog|file|link):/;

/** A dependency a package.json lists under a field. */
type Listed = { readonly field: string; readonly name: string; readonly range: string };

/**
 * A Definitions Package's own package.json as published: its version, peers as carets on the
 * versions it is built with and `cfLoom`, `snapshot.json` in its `files` and no `publishConfig.tag`; refused when it
 * depends on a range no registry can install.
 */
export function definitionsManifestOf(
  source: Readonly<Record<string, unknown>>,
  published: PublishedDefinitionsSnapshot,
  { peers }: Pick<Packaging, 'peers'>,
): DefinitionsManifest {
  const uninstallable = uninstallableDependencyOf(source);
  if (uninstallable !== undefined) {
    const { field, name: dependency, range } = uninstallable;
    const lists = `package.json lists ${dependency} in ${field} as ${range}`;
    return unpublishable(`${lists}, which npm cannot install from the registry`);
  }
  const manifest = {
    ...source,
    version: published.version,
    ...publishConfigWithoutTagOf(source['publishConfig']),
    ...filesWithSnapshotOf(source['files']),
    peerDependencies: peerRangesOf(peers),
    cfLoom: cfLoomOf(published),
  };
  return { kind: 'manifest', file: manifestFileOf(manifest) };
}

function unpublishable(line: string): DefinitionsManifest {
  return { kind: 'unpublishable', line };
}

/** The `publishConfig` field without its `tag`, which npm reads over the dist-tag `publish` chooses; a field that is no map stays as it is. */
function publishConfigWithoutTagOf(publishConfig: unknown): { readonly publishConfig?: unknown } {
  if (typeof publishConfig !== 'object' || publishConfig === null || Array.isArray(publishConfig)) {
    return {};
  }
  const kept = Object.entries(publishConfig).filter(([name]) => name !== 'tag');
  return { publishConfig: Object.fromEntries(kept) };
}

/** The `files` field with `snapshot.json` listed, if the package lists its files; one that lists none packs everything. */
function filesWithSnapshotOf(files: unknown): { readonly files?: readonly unknown[] } {
  return Array.isArray(files) ? { files: [...files, packagePaths.snapshot] } : {};
}

/** The first dependency, in the fields npm installs, whose range no registry can install. */
function uninstallableDependencyOf(source: Readonly<Record<string, unknown>>): Listed | undefined {
  for (const field of installedFields) {
    const range = uninstallableIn(source[field]);
    if (range !== undefined) {
      return { field, ...range };
    }
  }
  return undefined;
}

function uninstallableIn(
  dependencies: unknown,
): { readonly name: string; readonly range: string } | undefined {
  if (typeof dependencies !== 'object' || dependencies === null) {
    return undefined;
  }
  for (const [name, range] of Object.entries(dependencies)) {
    if (typeof range === 'string' && uninstallableRange.test(range)) {
      return { name, range };
    }
  }
  return undefined;
}
