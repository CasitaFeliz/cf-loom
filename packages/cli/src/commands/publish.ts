import { canonicalTextOf, publishedSnapshotOf } from '@cf-loom/contract/internal';
import type { Run } from '../project/index.ts';
import type { DerivedVersion, DeriveOptions } from '../versioning/index.ts';
import { comparedLinesOf, notAboveOf, nothingToPublishOf } from './check-lines.ts';
import { endingOf } from './checked.ts';
import { derivedCheckedOf } from './derivation.ts';
import { done, type Exit, toolingError } from './exit.ts';
import { type Prepared, preparedOf } from './prepared.ts';
import { publishedPackageOf, type ToPublish } from './published-package.ts';

/**
 * Publishes the package of the committed Snapshot through the organization's npm: checked against
 * its Baseline, failing on a refused Change, at the version its Changes and peer ranges derive,
 * with the Baseline's history merged in; it never waits on a Breaking Change Approval.
 */
export async function publish(run: Run, options: DeriveOptions): Promise<Exit> {
  const prepared = await preparedOf(run, undefined);
  if (prepared.kind === 'stopped') {
    return prepared.exit;
  }
  const checked = derivedCheckedOf(prepared, options);
  run.progress(comparedLinesOf(checked));
  const { derivation } = checked;
  if (derivation === null) {
    return { status: 1, stdout: [], stderr: endingOf(checked.changes).stderr };
  }
  const { derived } = derivation;
  switch (derived.kind) {
    case 'unchanged': {
      const nothing = nothingToPublishOf(checked.packageName, derived.baseline);
      return done([`${nothing}; --force publishes anyway`]);
    }
    case 'not-above':
      return toolingError(notAboveOf(checked.packageName, derived));
    case 'version':
      return await putExit(run, { prepared, packageName: checked.packageName, derived });
  }
}

/** A publish that goes on: the comparison it was prepared from, the package, and the version it derived. */
type Ready = {
  readonly prepared: Prepared;
  readonly packageName: string;
  readonly derived: DerivedVersion;
};

async function putExit(run: Run, { prepared, packageName, derived }: Ready): Promise<Exit> {
  const { put, left } = await publishedPackageOf(run, toPublishOf(prepared, derived));
  if (put.kind === 'failed') {
    return { status: 3, stdout: [], stderr: [put.message, ...left] };
  }
  const published = `Published ${packageName}@${derived.version}`;
  return { status: 0, stdout: [published], stderr: left };
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
