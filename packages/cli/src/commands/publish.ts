import { canonicalTextOf, publishedSnapshotOf, versionBumpOf } from '@cf-loom/contract/internal';
import { type Peers, peerRangesOf } from '../contract-package/index.ts';
import type { Run } from '../project/index.ts';
import { comparedLinesOf } from './check-lines.ts';
import { endingOf } from './checked.ts';
import {
  type Comparison,
  checkedFrom,
  committedBuiltOf,
  comparisonOf,
  type Stopped,
} from './comparison.ts';
import { done, type Exit, toolingError } from './exit.ts';
import { builtPeersOf } from './peers.ts';
import { publishedPackageOf, type ToPublish } from './published-package.ts';
import {
  type DerivedVersion,
  type Deriving,
  derivedVersionOf,
  type PublishOptions,
} from './published-version.ts';

/** What a publish goes on with once the Snapshot is compared: the comparison and the peers the package is built with. */
type Prepared = {
  readonly kind: 'prepared';
  readonly comparison: Comparison;
  readonly peers: Peers;
};

/**
 * Publishes the package of the committed Snapshot through the organization's npm: checked against
 * its Baseline, refused when a Change is Not allowed, at the version its Changes and peer ranges
 * derive, with the Baseline's history merged in; it never waits on a Breaking Change Approval.
 */
export async function publish(run: Run, options: PublishOptions): Promise<Exit> {
  const prepared = await preparedOf(run);
  if (prepared.kind === 'stopped') {
    return prepared.exit;
  }
  const checked = checkedFrom(prepared.comparison);
  const { status, stderr } = endingOf(checked.changes);
  const opening = comparedLinesOf(checked);
  if (status === 1) {
    return { status, stdout: opening, stderr };
  }
  const derived = derivedVersionOf(derivingOf(prepared, options));
  if (derived.kind === 'unchanged') {
    const same = `${checked.packageName}@${derived.baseline}`;
    const nothing = `Nothing to publish: the Snapshot and peer ranges are those of ${same}`;
    return done([...opening, `${nothing}; --force publishes anyway`]);
  }
  const put = await publishedPackageOf(run, toPublishOf(prepared, derived));
  if (put.kind === 'failed') {
    return toolingError(put.message);
  }
  return done([...opening, `Published ${checked.packageName}@${derived.version}`]);
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
  const comparison = await comparisonOf(built, run);
  if (comparison.kind === 'stopped') {
    return comparison;
  }
  return { kind: 'prepared', comparison, peers: peers.peers };
}

/** What the version is derived from: the Baseline and how far the Changes and peers move from it, and every listed version. */
function derivingOf({ comparison, peers }: Prepared, options: PublishOptions): Deriving {
  switch (comparison.kind) {
    case 'no-baseline': {
      const { why } = comparison;
      const versions = why.kind === 'only-prereleases' ? why.versions : [];
      return { baseline: undefined, versions, ...options };
    }
    case 'baseline': {
      const { read, report } = comparison;
      const bump = versionBumpOf(report, { baseline: read.peers, proposed: peerRangesOf(peers) });
      const baseline = { version: read.snapshot.version, bump };
      return { baseline, versions: read.versions, ...options };
    }
  }
}

/** The Snapshot as published at the derived version, with the Baseline's history merged in. */
function toPublishOf({ comparison, peers }: Prepared, { version, tag }: DerivedVersion): ToPublish {
  const { project, snapshot } = comparison.built;
  const baseline = comparison.kind === 'baseline' ? comparison.read.snapshot : undefined;
  const published = publishedSnapshotOf(baseline, snapshot, version);
  return { project, published, text: canonicalTextOf(published), peers, tag };
}
