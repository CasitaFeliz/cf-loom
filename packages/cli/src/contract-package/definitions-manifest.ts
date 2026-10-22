import type { PublishedDefinitionsSnapshot } from '@cf-loom/contract/internal';
import { publishedNameOf } from '../loading/index.ts';
import { cfLoomOf, type Packaging, peerRangesOf } from './manifest.ts';
import type { PackageFile } from './modules.ts';
import { packagePaths } from './paths.ts';

/** A Definitions Package's package.json as published, or the line saying why it cannot be. */
export type DefinitionsManifest =
  | { readonly kind: 'manifest'; readonly file: PackageFile }
  | { readonly kind: 'unpublishable'; readonly line: string };

/** The ranges npm publishes unchanged and no registry can install. */
const uninstallableRange = /^(workspace|catalog):/;

/**
 * A Definitions Package's own package.json as published: its version, peers as carets on the
 * versions it is built with and `cfLoom`, and `snapshot.json` in its `files`; refused when it is
 * not named as the package it publishes as, or depends on a range no registry can install.
 */
export function definitionsManifestOf(
  source: Readonly<Record<string, unknown>>,
  published: PublishedDefinitionsSnapshot,
  { scope, peers }: Pick<Packaging, 'scope' | 'peers'>,
): DefinitionsManifest {
  const name = publishedNameOf(scope, published);
  if (source['name'] !== name) {
    const named = `package.json names ${String(source['name'])}`;
    return unpublishable(
      `${named}, but a Definitions Package of scope ${scope} publishes as ${name}`,
    );
  }
  const uninstallable = uninstallableDependencyOf(source['dependencies']);
  if (uninstallable !== undefined) {
    const [dependency, range] = uninstallable;
    const depends = `package.json depends on ${dependency} as ${range}`;
    return unpublishable(`${depends}, which npm cannot install from the registry`);
  }
  const files = source['files'];
  const manifest = {
    ...source,
    version: published.version,
    ...(Array.isArray(files) ? { files: [...files, packagePaths.snapshot] } : {}),
    peerDependencies: peerRangesOf(peers),
    cfLoom: cfLoomOf(published),
  };
  const text = `${JSON.stringify(manifest, null, 2)}\n`;
  return { kind: 'manifest', file: { path: packagePaths.manifest, text } };
}

function unpublishable(line: string): DefinitionsManifest {
  return { kind: 'unpublishable', line };
}

/** The first dependency whose range npm publishes unchanged and no registry can install. */
function uninstallableDependencyOf(dependencies: unknown): [string, string] | undefined {
  if (typeof dependencies !== 'object' || dependencies === null) {
    return undefined;
  }
  const ranges = Object.entries(dependencies);
  return ranges.find(([, range]) => typeof range === 'string' && uninstallableRange.test(range));
}
