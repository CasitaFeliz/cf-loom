import {
  decodeSnapshot,
  type PeerRanges,
  type PublishedSnapshot,
  type Snapshot,
} from '@cf-loom/contract/internal';
import { publishedNameOf } from '../contract-package/index.ts';
import { type Failed, failed, jsonFromNpm, type NpmPlace, type Refused } from './npm.ts';
import { snapshotTextOf } from './tarball.ts';
import { type UnknownPackage, unknownPackageOf } from './unknown-package.ts';
import {
  type BaselineSource,
  highestReleaseOf,
  type Release,
  releaseFrom,
  type Versions,
  versionsFrom,
} from './versions.ts';

/** Why a package has no Baseline: the registry npm reads its scope from does not know it, or it has only prereleases. */
export type NoBaseline =
  | UnknownPackage
  | { readonly kind: 'only-prereleases'; readonly versions: readonly string[] };

/** A package's Baseline as its registry holds it, why it has none, or why it cannot be read. */
export type ReadBaseline =
  | {
      readonly kind: 'baseline';
      readonly packageName: string;
      /** The published Snapshot of the highest version that is not a prerelease. */
      readonly snapshot: PublishedSnapshot;
      /** That version's peer ranges, which the peer rule compares with the proposed ones. */
      readonly peers: PeerRanges;
      /** Every published version, prereleases included, lowest first. */
      readonly versions: readonly string[];
    }
  | { readonly kind: 'no-baseline'; readonly packageName: string; readonly why: NoBaseline }
  | Failed;

type Declared = Pick<Snapshot, 'kind' | 'name'>;

/** A package and every version it lists, lowest first. */
type Published = { readonly packageName: string; readonly versions: readonly string[] };

/**
 * Reads, through the organization's own npm, the Baseline of the package a declared Snapshot
 * publishes as under `scope`: the highest published version that is not a prerelease, its
 * metadata, and only its `snapshot.json`; anything that cannot be proven fails closed.
 */
export async function baselineOf(
  npm: NpmPlace,
  declared: Declared,
  scope: string,
): Promise<ReadBaseline> {
  const packageName = publishedNameOf(scope, declared);
  const listed = await versionsOf(npm, packageName);
  switch (listed.kind) {
    case 'failed':
      return listed;
    case 'unknown-package':
      return await unknownPackageOf(npm, packageName, scope);
    case 'versions':
      return await baselineAmong(npm, { packageName, versions: listed.versions }, declared);
  }
}

async function versionsOf(
  npm: NpmPlace,
  packageName: string,
): Promise<Versions | Failed | { readonly kind: 'unknown-package' }> {
  const call = { label: `npm view ${packageName}`, args: ['view', packageName, 'versions'] };
  const run = await jsonFromNpm(npm, call);
  switch (run.kind) {
    case 'json':
      return versionsFrom(packageName, run.value);
    case 'refused':
      return refusedViewOf(packageName, run);
    case 'failed':
      return run;
  }
}

function refusedViewOf(
  packageName: string,
  refused: Refused,
): Failed | { readonly kind: 'unknown-package' } {
  if (refused.code !== 'E404') {
    return failed(refused.message);
  }
  if (refused.summary.startsWith('Unpublished on')) {
    const gone = 'its Baseline is gone, so nothing can be checked against it';
    return failed(`${packageName} was unpublished: ${refused.summary}; ${gone}`);
  }
  return { kind: 'unknown-package' };
}

async function baselineAmong(
  npm: NpmPlace,
  { packageName, versions }: Published,
  declared: Declared,
): Promise<ReadBaseline> {
  const version = highestReleaseOf(versions);
  if (version === undefined) {
    return { kind: 'no-baseline', packageName, why: { kind: 'only-prereleases', versions } };
  }
  const source = { spec: `${packageName}@${version}`, version, declared };
  const release = await releaseOf(npm, source);
  if (release.kind === 'failed') {
    return release;
  }
  const text = await snapshotTextOf(npm, source.spec);
  if (text.kind === 'failed') {
    return text;
  }
  const snapshot = snapshotFrom(source, text.text);
  if (snapshot.kind === 'failed') {
    return snapshot;
  }
  const { peers } = release;
  return { kind: 'baseline', packageName, snapshot: snapshot.snapshot, peers, versions };
}

async function releaseOf(npm: NpmPlace, source: BaselineSource): Promise<Release | Failed> {
  const { spec } = source;
  const fields = ['version', 'cfLoom', 'peerDependencies', 'dist'];
  const run = await jsonFromNpm(npm, {
    label: `npm view ${spec}`,
    args: ['view', spec, ...fields],
  });
  switch (run.kind) {
    case 'json':
      return releaseFrom(source, run.value);
    case 'refused':
      return failed(run.message);
    case 'failed':
      return run;
  }
}

function snapshotFrom(
  source: BaselineSource,
  text: string,
): { readonly kind: 'snapshot'; readonly snapshot: PublishedSnapshot } | Failed {
  const { spec, version, declared } = source;
  const decoded = decodeSnapshot(text);
  switch (decoded.kind) {
    case 'no-json':
      return failed(`${spec}'s snapshot.json is no JSON (${decoded.reason})`);
    case 'newer-format': {
      const newer = `in format ${decoded.format}, newer than this cf-loom reads: upgrade @cf-loom/cli`;
      return failed(`${spec}'s snapshot.json is ${newer}`);
    }
    case 'malformed': {
      const location = decoded.at.length === 0 ? '(root)' : decoded.at.join('.');
      return failed(`${spec}'s snapshot.json is malformed: ${location} ${decoded.reason}`);
    }
    case 'decoded': {
      const { snapshot } = decoded;
      const isBaseline =
        snapshot.name === declared.name &&
        snapshot.kind === declared.kind &&
        snapshot.version === version;
      const found = `${snapshot.name}@${snapshot.version} (${snapshot.kind})`;
      return isBaseline
        ? { kind: 'snapshot', snapshot }
        : failed(`${spec}'s snapshot.json is ${found}, not ${spec}`);
    }
  }
}
