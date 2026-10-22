import {
  compareSemanticVersions,
  isPrerelease,
  isSemanticVersion,
  ownOf,
  type PeerRanges,
  type Snapshot,
} from '@cf-loom/contract/internal';
import { type Failed, failed } from './npm.ts';

const sha512 = /^sha512-([A-Za-z0-9+/]{86}==)(?:\?\S*)?$/;

/** The versions a package lists, lowest first. */
export type Versions = { readonly kind: 'versions'; readonly versions: readonly string[] };

/** What a version's metadata says that a Baseline relies on: its peer ranges and the sha512 digests of its tarball. */
export type VersionMetadata = {
  readonly kind: 'metadata';
  readonly peers: PeerRanges;
  readonly digests: readonly string[];
};

/** The version of a package a Baseline is read from, and the declared Snapshot it must be the Baseline of. */
export type BaselineSource = {
  readonly spec: string;
  readonly version: string;
  readonly declared: Pick<Snapshot, 'kind' | 'name'>;
};

/**
 * The versions `npm view <package> versions` printed, lowest first; a package that lists none, or
 * a key that is no semantic version, is a failure, since the highest version cannot be proven.
 */
export function versionsFrom(packageName: string, printed: unknown): Versions | Failed {
  const items: readonly unknown[] = Array.isArray(printed) ? printed : [printed];
  if (items.length === 0 || printed === undefined) {
    return failed(
      `${packageName} lists no version, or has no latest dist-tag, which npm view needs to list them`,
    );
  }
  const unreadable = items.find((item) => !isSemanticVersion(item));
  if (unreadable !== undefined) {
    const key = typeof unreadable === 'string' ? unreadable : JSON.stringify(unreadable);
    return failed(`${packageName} lists ${key}, which is no semantic version`);
  }
  return {
    kind: 'versions',
    versions: items.filter(isSemanticVersion).sort(compareSemanticVersions),
  };
}

/** The version of the Baseline: the highest of versions listed lowest first that is not a prerelease. */
export function baselineVersionOf(versions: readonly string[]): string | undefined {
  return versions.filter((version) => !isPrerelease(version)).at(-1);
}

/**
 * The metadata `npm view <package>@<version>` printed for the version a Baseline is read from:
 * published by cf-loom as the declared kind, with peer ranges that are a map of texts and a
 * tarball with a sha512 digest to check it against.
 */
export function metadataFrom(source: BaselineSource, printed: unknown): VersionMetadata | Failed {
  const { spec, version, declared } = source;
  if (ownOf(printed, 'version') !== version) {
    return failed(`npm view ${spec} printed no metadata`);
  }
  const kind = ownOf(ownOf(printed, 'cfLoom'), 'kind');
  if (typeof kind !== 'string') {
    return failed(`${spec} has no cfLoom: it was not published by cf-loom publish`);
  }
  if (kind !== declared.kind) {
    return failed(`${spec} is the package of kind ${kind}, not ${declared.kind}`);
  }
  const peers = peersFrom(ownOf(printed, 'peerDependencies'));
  if (peers === undefined) {
    return failed(`${spec} has peerDependencies that are no map of ranges`);
  }
  const digests = digestsOf(spec, ownOf(printed, 'dist'));
  return digests.kind === 'failed'
    ? digests
    : { kind: 'metadata', peers, digests: digests.digests };
}

function peersFrom(peerDependencies: unknown): PeerRanges | undefined {
  if (peerDependencies === undefined) {
    return {};
  }
  if (
    typeof peerDependencies !== 'object' ||
    peerDependencies === null ||
    Array.isArray(peerDependencies)
  ) {
    return undefined;
  }
  const peers: Record<string, string> = {};
  for (const [name, range] of Object.entries(peerDependencies)) {
    if (typeof range !== 'string') {
      return undefined;
    }
    peers[name] = range;
  }
  return peers;
}

function digestOf(hash: string): string | undefined {
  return sha512.exec(hash)?.[1];
}

function isDigest(digest: string | undefined): digest is string {
  return digest !== undefined;
}

function digestsOf(
  spec: string,
  dist: unknown,
): { readonly kind: 'digests'; readonly digests: readonly string[] } | Failed {
  if (typeof ownOf(dist, 'tarball') !== 'string') {
    return failed(`${spec} has no tarball`);
  }
  const integrity = ownOf(dist, 'integrity');
  const hashes = typeof integrity === 'string' ? integrity.split(/\s+/) : [];
  const digests = hashes.map(digestOf).filter(isDigest);
  if (digests.length === 0) {
    return failed(`${spec} has no sha512 integrity, so its tarball cannot be verified`);
  }
  return { kind: 'digests', digests };
}
