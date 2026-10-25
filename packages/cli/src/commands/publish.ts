import {
  canonicalTextOf,
  type PeerRanges,
  publishedSnapshotOf,
  versionBumpOf,
} from '@cf-loom/contract/internal';
import type { Run } from '../project/index.ts';
import {
  type DerivedVersion,
  type Deriving,
  derivedVersionOf,
  type PublishOptions,
} from '../versioning/index.ts';
import { comparedLinesOf } from './check-lines.ts';
import { type Checked, endingOf } from './checked.ts';
import { type Comparison, checkedFrom, committedBuiltOf, comparisonOf } from './comparison.ts';
import { done, type Exit, type Stopped, toolingError } from './exit.ts';
import { builtPeersOf, publishedRangesOf } from './peers.ts';
import { publishedPackageOf, type ToPublish } from './published-package.ts';

/** What a publish goes on with once the Snapshot is compared: the comparison and the peer ranges the package is published with. */
type Prepared = {
  readonly kind: 'prepared';
  readonly comparison: Comparison;
  readonly peerRanges: PeerRanges;
};

/**
 * Publishes the package of the committed Snapshot through the organization's npm: checked against
 * its Baseline, failing on a refused Change, at the version its Changes and peer ranges derive,
 * with the Baseline's history merged in; it never waits on a Breaking Change Approval.
 */
export async function publish(run: Run, options: PublishOptions): Promise<Exit> {
  const prepared = await preparedOf(run);
  if (prepared.kind === 'stopped') {
    return prepared.exit;
  }
  const checked = checkedFrom(prepared.comparison);
  run.progress(comparedLinesOf(checked));
  const { status, stderr } = endingOf(checked.changes);
  if (status === 1) {
    return { status, stdout: [], stderr };
  }
  const derived = derivedVersionOf(derivingOf(prepared, options));
  switch (derived.kind) {
    case 'unchanged': {
      const same = `${checked.packageName}@${derived.baseline}`;
      const nothing = `Nothing to publish: the Snapshot and peer ranges are those of ${same}`;
      return done([`${nothing}; --force publishes anyway`]);
    }
    case 'not-above': {
      const would = `${checked.packageName}@${derived.version} would not be above the Baseline`;
      return toolingError(`${would} ${derived.baseline}: publish a version above it by hand`);
    }
    case 'version':
      return await putExit(run, { prepared, checked, derived });
  }
}

/** A publish that goes on: the comparison it was prepared from, what `check` reported of it, and the version it derived. */
type Ready = {
  readonly prepared: Prepared;
  readonly checked: Checked;
  readonly derived: DerivedVersion;
};

async function putExit(run: Run, { prepared, checked, derived }: Ready): Promise<Exit> {
  const { put, left } = await publishedPackageOf(run, toPublishOf(prepared, derived));
  if (put.kind === 'failed') {
    return { status: 3, stdout: [], stderr: [put.message, ...left] };
  }
  const published = `Published ${checked.packageName}@${derived.version}`;
  return { status: 0, stdout: [published], stderr: left };
}

async function preparedOf(run: Run): Promise<Prepared | Stopped> {
  const built = await committedBuiltOf(run);
  if (built.kind === 'stopped') {
    return built;
  }
  const peers = builtPeersOf(built);
  if (peers.kind === 'failed') {
    return { kind: 'stopped', exit: toolingError(peers.message) };
  }
  const peerRanges = publishedRangesOf(built, peers.peers);
  const comparison = await comparisonOf(built, run, undefined);
  if (comparison.kind === 'stopped') {
    return comparison;
  }
  return { kind: 'prepared', comparison, peerRanges };
}

/** What the version is derived from: the Baseline and how far the Changes and peers move from it, and every listed version. */
function derivingOf({ comparison, peerRanges }: Prepared, options: PublishOptions): Deriving {
  switch (comparison.kind) {
    case 'no-baseline':
      return { baseline: undefined, versions: [], ...options };
    case 'baseline': {
      const { read, report } = comparison;
      const bump = versionBumpOf(report, { baseline: read.peers, proposed: peerRanges });
      const baseline = { version: read.snapshot.version, stable: read.stable, bump };
      return { baseline, versions: read.versions, ...options };
    }
  }
}

/** The Snapshot as published at the derived version, with the Baseline's history merged in. */
function toPublishOf(
  { comparison, peerRanges }: Prepared,
  { version, tag }: DerivedVersion,
): ToPublish {
  const { project, snapshot } = comparison.built;
  const baseline = comparison.kind === 'baseline' ? comparison.read.snapshot : undefined;
  const published = publishedSnapshotOf(baseline, snapshot, version);
  const highest = baseline?.version;
  const text = canonicalTextOf(published);
  return { project, declared: comparison.built, published, text, peerRanges, tag, highest };
}
