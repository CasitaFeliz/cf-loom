import {
  decodeSnapshot,
  type PeerRanges,
  type PublishedSnapshot,
  problemLineOf,
  type Snapshot,
} from '@cf-loom/contract/internal';
import { type Failed, failed } from '../child-process/index.ts';
import { newerFormatTextOf } from '../loading/index.ts';
import { type ChosenVersion, chosenVersionOf, unlistedAgainstOf } from './against.ts';
import { jsonFromNpm, type NpmPlace } from './npm.ts';
import { versionsOf } from './package-versions.ts';
import { snapshotTextOf } from './tarball.ts';
import { type UnknownPackage, unknownPackageOf } from './unknown-package.ts';
import {
  type BaselineSource,
  metadataFrom,
  type VersionMetadata,
  type Versions,
} from './versions.ts';

/** Why a package has no Baseline: the registry npm reads it from does not know it. */
export type NoBaseline = UnknownPackage;

/** A package's Baseline as its registry holds it, why it has none, or why it cannot be read. */
export type ReadBaseline =
  | {
      readonly kind: 'baseline';
      readonly packageName: string;
      /** The published Snapshot of the highest version, a prerelease included, or of the one `--against` names. */
      readonly snapshot: PublishedSnapshot;
      /** That version's peer ranges, which the peer rule compares with the proposed ones. */
      readonly peers: PeerRanges;
      /** Every published version, prereleases included, lowest first. */
      readonly versions: readonly string[];
      /** The highest published version that is not a prerelease, which a prerelease Baseline's version derives from. */
      readonly stable: string | undefined;
      /** How the version compared with was chosen: the Baseline, or the one `--against` named. */
      readonly chosen: ChosenVersion['chosen'];
    }
  | { readonly kind: 'no-baseline'; readonly packageName: string; readonly why: NoBaseline }
  | Failed;

type Declared = Pick<Snapshot, 'kind' | 'name'>;

/** The package whose Baseline is read: its name, the declared Snapshot it publishes, and the version `check --against` names. */
export type BaselineQuery = {
  readonly packageName: string;
  readonly declared: Declared;
  readonly against: string | undefined;
};

const unnamable = failed('cannot name the package to read: a package name must be a text');

/** A package and the versions it lists. */
type Published = { readonly packageName: string; readonly listed: Versions };

/**
 * Reads, through the organization's own npm, the Baseline of the package a declared Snapshot
 * publishes as: the highest published version, a prerelease included, or the one
 * `against` names, its metadata, and only its `snapshot.json`; anything that cannot be proven
 * fails closed.
 */
export async function baselineOf(
  npm: NpmPlace,
  { packageName, declared, against }: BaselineQuery,
): Promise<ReadBaseline> {
  if (typeof packageName !== 'string') {
    return unnamable;
  }
  const listed = await versionsOf(npm, packageName);
  switch (listed.kind) {
    case 'failed':
      return listed;
    case 'not-found':
      return against === undefined
        ? await baselineOfMissing(npm, packageName)
        : unlistedAgainstOf(packageName, against);
    case 'versions':
      return await baselineAmong(npm, { packageName, listed }, { declared, against });
  }
}

async function baselineOfMissing(npm: NpmPlace, packageName: string): Promise<ReadBaseline> {
  const unknown = await unknownPackageOf(npm, packageName);
  return unknown.kind === 'failed' ? unknown : { kind: 'no-baseline', packageName, why: unknown };
}

async function baselineAmong(
  npm: NpmPlace,
  { packageName, listed }: Published,
  { declared, against }: Pick<BaselineQuery, 'declared' | 'against'>,
): Promise<ReadBaseline> {
  const chosen = await chosenVersionOf(npm, listed, { packageName, against });
  if (chosen.kind === 'failed') {
    return chosen;
  }
  const { version } = chosen;
  const source = { spec: `${packageName}@${version}`, version, declared };
  const metadata = await metadataOf(npm, source);
  if (metadata.kind === 'failed') {
    return metadata;
  }
  const text = await snapshotTextOf(npm, { spec: source.spec, digests: metadata.digests });
  if (text.kind === 'failed') {
    return text;
  }
  const snapshot = snapshotFrom(source, text.text);
  if (snapshot.kind === 'failed') {
    return snapshot;
  }
  const { peers } = metadata;
  const { versions, stable } = listed;
  const read = { snapshot: snapshot.snapshot, peers, versions, stable, chosen: chosen.chosen };
  return { kind: 'baseline', packageName, ...read };
}

async function metadataOf(
  npm: NpmPlace,
  source: BaselineSource,
): Promise<VersionMetadata | Failed> {
  const { spec } = source;
  const fields = ['version', 'cfLoom', 'peerDependencies', 'dist'];
  const run = await jsonFromNpm(npm, {
    label: `npm view ${spec}`,
    args: ['view', spec, ...fields],
  });
  switch (run.kind) {
    case 'json':
      return metadataFrom(source, run.value);
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
    case 'newer-format':
      return failed(newerFormatTextOf(`${spec}'s snapshot.json`, decoded.format));
    case 'malformed':
      return failed(`${spec}'s snapshot.json is malformed: ${problemLineOf(decoded)}`);
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
