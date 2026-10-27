import {
  isSemanticVersion,
  ownOf,
  type PeerRanges,
  type Snapshot,
} from '@cf-loom/contract/internal';
import { type Failed, failed } from '../child-process/index.ts';
import { compareSemanticVersions } from '../versioning/index.ts';

const sha512 = /^sha512-([A-Za-z0-9+/]{86}==)(?:\?\S*)?$/;

/** What the registry lists for a package: its name and its versions, lowest first, none when npm does not know it. */
export type Listing = { readonly packageName: string; readonly versions: readonly string[] };

/** The listing of a package that lists at least one version. */
export type Versions = { readonly kind: 'versions'; readonly listing: Listing };

/** What a version's metadata says that a Baseline relies on: its peer ranges and the sha512 digests of its tarball. */
export type VersionMetadata = {
  readonly kind: 'metadata';
  readonly peers: PeerRanges;
  readonly digests: readonly string[];
};

/** A version whose package.json carries no `cfLoom`: it was not published by cf-loom, so it is no Baseline. */
export type NotPublishedByCfLoom = { readonly kind: 'not-cf-loom' };

/** A version of a package and the Snapshot its tarball must hold: the kind and name it declares, at its version. */
export type ExpectedSnapshot = {
  readonly spec: string;
  readonly version: string;
  readonly declared: Pick<Snapshot, 'kind' | 'name'>;
};

/**
 * The versions `npm view <package> versions` printed, lowest first; a package that lists none, or
 * a key that is no semantic version, is a failure, since the Baseline cannot be chosen.
 */
export function versionsFrom(packageName: string, printed: unknown): Versions | Failed {
  const items = keysPrintedIn(printed);
  const unreadable = items.find((item) => !isSemanticVersion(item));
  if (unreadable !== undefined) {
    const key = typeof unreadable === 'string' ? unreadable : JSON.stringify(unreadable);
    return failed(`${packageName} lists ${key}, which is no semantic version`);
  }
  const versions = items.filter(isSemanticVersion).sort(compareSemanticVersions);
  if (versions.length === 0) {
    const none = `${packageName} lists no version, or has no latest dist-tag, which npm view needs to list them`;
    return failed(none);
  }
  return { kind: 'versions', listing: { packageName, versions } };
}

/** The keys npm printed for `versions`: none when it printed nothing, one when the package lists one version. */
function keysPrintedIn(printed: unknown): readonly unknown[] {
  if (printed === undefined) {
    return [];
  }
  return Array.isArray(printed) ? printed : [printed];
}

/** Tells a version cf-loom published from one it did not, since only the first can be the Baseline, and fails on a malformed `cfLoom` rather than passing over it. */
export function metadataFrom(
  source: ExpectedSnapshot,
  printed: unknown,
): VersionMetadata | NotPublishedByCfLoom | Failed {
  const { spec, version, declared } = source;
  if (ownOf(printed, 'version') !== version) {
    return failed(`npm view ${spec} printed no metadata`);
  }
  const cfLoom = ownOf(printed, 'cfLoom');
  if (cfLoom === undefined) {
    return { kind: 'not-cf-loom' };
  }
  const kind = ownOf(cfLoom, 'kind');
  if (typeof kind !== 'string') {
    return failed(`${spec} has a malformed cfLoom: its kind is no text`);
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
