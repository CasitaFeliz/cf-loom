import {
  decodeSnapshot,
  type PeerRanges,
  type PublishedSnapshot,
  problemLineOf,
  type Snapshot,
} from '@cf-loom/contract/internal';
import { type Failed, failed } from '../child-process/index.ts';
import { newerFormatTextOf } from '../loading/index.ts';
import { type Choice, choiceOf, unlistedAgainstOf } from './against.ts';
import { type Found, foundIn } from './found-version.ts';
import type { NpmPlace } from './npm.ts';
import { versionsOf } from './package-versions.ts';
import { snapshotTextOf } from './tarball.ts';
import { type UnknownPackage, unknownPackageOf } from './unknown-package.ts';
import type { BaselineSource, Listing } from './versions.ts';

/** A package that lists versions, none of which cf-loom published. */
export type NonePublished = { readonly kind: 'none-published' };

/** Why a package has no Baseline: the registry npm reads it from does not know it, or none of its versions carries `cfLoom`. */
export type NoBaseline = UnknownPackage | NonePublished;

/** A package's Baseline as its registry holds it: the published Snapshot compared with, its peer ranges, and how it was chosen. */
export type Baseline = {
  readonly kind: 'baseline';
  /** The published Snapshot of the Baseline, or of the one `--against` names. */
  readonly snapshot: PublishedSnapshot;
  /** That version's peer ranges, which the peer rule compares with the proposed ones. */
  readonly peers: PeerRanges;
  /** How the version compared with was chosen: the Baseline, or the one `--against` named. */
  readonly chosen: Choice['kind'];
};

/** What a read of a package gives: what the registry lists for it, whatever came of its Baseline, then the Baseline or why there is none; or why the package cannot be read. */
export type ReadBaseline =
  | {
      readonly kind: 'read';
      readonly listing: Listing;
      readonly baseline: Baseline | NoBaseline;
    }
  | Failed;

type Declared = Pick<Snapshot, 'kind' | 'name'>;

/** The package whose Baseline is read: its name, the declared Snapshot it publishes, and the version `check --against` names. */
export type BaselineQuery = {
  readonly packageName: string;
  readonly declared: Declared;
  readonly against: string | undefined;
};

const unnamable = failed('cannot name the package to read: a package name must be a text');

/**
 * Reads, through the organization's own npm, the Baseline of the package a declared Snapshot
 * publishes as: the highest version that is not a prerelease and carries `cfLoom`, else the
 * highest prerelease that does, or the one `against` names; its metadata, and only its
 * `snapshot.json`; anything that cannot be proven fails closed.
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
      return await baselineAmong(npm, listed.listing, { declared, against });
  }
}

async function baselineOfMissing(npm: NpmPlace, packageName: string): Promise<ReadBaseline> {
  const unknown = await unknownPackageOf(npm, packageName);
  if (unknown.kind === 'failed') {
    return unknown;
  }
  return { kind: 'read', listing: { packageName, versions: [] }, baseline: unknown };
}

async function baselineAmong(
  npm: NpmPlace,
  listing: Listing,
  { declared, against }: Pick<BaselineQuery, 'declared' | 'against'>,
): Promise<ReadBaseline> {
  const choice = await choiceOf(npm, listing, against);
  if (choice.kind === 'failed') {
    return choice;
  }
  const { packageName } = listing;
  const found = await foundIn(npm, choice, { packageName, declared });
  switch (found.kind) {
    case 'found':
      return await baselineRead(npm, found, { listing, chosen: choice.kind });
    case 'none-found':
      return { kind: 'read', listing, baseline: { kind: 'none-published' } };
    case 'failed':
      return found;
  }
}

/** The Baseline's `snapshot.json`, read from its tarball and checked against the version, with its peer ranges. */
async function baselineRead(
  npm: NpmPlace,
  { source, metadata }: Found,
  { listing, chosen }: Pick<Baseline, 'chosen'> & { readonly listing: Listing },
): Promise<ReadBaseline> {
  const text = await snapshotTextOf(npm, { spec: source.spec, digests: metadata.digests });
  if (text.kind === 'failed') {
    return text;
  }
  const snapshot = snapshotFrom(source, text.text);
  if (snapshot.kind === 'failed') {
    return snapshot;
  }
  const { peers } = metadata;
  const baseline = { kind: 'baseline', snapshot: snapshot.snapshot, peers, chosen } as const;
  return { kind: 'read', listing, baseline };
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
