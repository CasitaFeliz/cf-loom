import type { PeerRanges, PublishedDefinitionsSnapshot } from '@cf-loom/contract/internal';
import { cfLoomOf, manifestFileOf, type Packaging } from './manifest.ts';
import type { PackageFile } from './modules.ts';
import { packagePaths } from './paths.ts';

/** A Definitions Package's package.json as published, or the line saying why it cannot be. */
export type DefinitionsManifest =
  | { readonly kind: 'manifest'; readonly file: PackageFile }
  | { readonly kind: 'unpublishable'; readonly line: string };

/** The fields of a package.json whose dependencies npm installs with the package. */
const installedFields = ['dependencies', 'optionalDependencies', 'peerDependencies'] as const;

/** What npm reads as a path, a URL or a protocol: text that holds `:`, `/` or `\`, or starts with a dot. */
const notRegistryText = /[:/\\]|^\./;

/** What npm reads as a file: text that ends as a tarball's name does. */
const tarballName = /\.(?:tgz|tar\.gz|tar)$/i;

/** The start of an `npm:` alias, which npm reads case-insensitively. */
const aliasPrefix = /^npm:/i;

/** An `npm:` alias that names a registry package, capturing its name without a scope and the spec after the `@` that follows the name. */
const aliasedPackage = /^npm:(?:@[^@/\\:]+\/)?([^@/\\:]+)(?:@(.*))?$/i;

/** A dependency a package.json lists under a field. */
type Listed = { readonly field: string; readonly name: string; readonly range: string };

/**
 * A Definitions Package's own package.json as published: its version, its peers with `zod` and
 * `@cf-loom/contract` set to the ranges the CLI declares, and `cfLoom`, `snapshot.json`
 * in its `files` and no `publishConfig.tag`; refused when it depends on a range npm does not
 * resolve from the registry, a peer read after those two are set.
 */
export function definitionsManifestOf(
  source: Readonly<Record<string, unknown>>,
  published: PublishedDefinitionsSnapshot,
  { peerRanges }: Pick<Packaging, 'peerRanges'>,
): DefinitionsManifest {
  const manifest = {
    ...source,
    version: published.version,
    ...publishConfigWithoutTagOf(source['publishConfig']),
    ...filesWithSnapshotOf(source['files']),
    peerDependencies: peerRanges,
    cfLoom: cfLoomOf(published),
  };
  const uninstallable = uninstallableDependencyOf(manifest);
  if (uninstallable !== undefined) {
    const { field, name: dependency, range } = uninstallable;
    const lists = `package.json lists ${dependency} in ${field} as ${range}`;
    return unpublishable(`${lists}, which npm cannot install from the registry`);
  }
  return { kind: 'manifest', file: manifestFileOf(manifest) };
}

/**
 * The peers a Definitions Package is published with: those its package.json lists, `zod` and
 * `@cf-loom/contract` set to the ranges the CLI declares. The manifest writes them and the version
 * derivation compares them with the Baseline's, so the two never differ.
 */
export function publishedPeersOf(
  source: Readonly<Record<string, unknown>>,
  ranges: PeerRanges,
): PeerRanges {
  const listed = source['peerDependencies'];
  const isMap = typeof listed === 'object' && listed !== null && !Array.isArray(listed);
  const entries = isMap ? Object.entries(listed) : [];
  const listedRanges = entries.filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string',
  );
  return { ...Object.fromEntries(listedRanges), ...ranges };
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

/** The first dependency, in the fields npm installs, whose range npm does not resolve from the registry. */
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
    if (typeof range === 'string' && !isRegistryRange(range)) {
      return { name, range };
    }
  }
  return undefined;
}

/**
 * Whether npm resolves a dependency's range from the registry: a semver range, a dist-tag, or an
 * `npm:` alias of one. Without a semver parser, a malformed range or tag reads as a valid one.
 */
function isRegistryRange(range: string): boolean {
  if (!aliasPrefix.test(range)) {
    return isRegistryText(range);
  }
  const alias = aliasedPackage.exec(range);
  return alias !== null && isRegistryText(alias[1] ?? '') && isRegistryText(alias[2] ?? '');
}

/** Whether npm reads a spec, or the name of an alias, as neither a path, a URL, a protocol nor a tarball. */
function isRegistryText(text: string): boolean {
  return !notRegistryText.test(text) && !tarballName.test(text);
}
