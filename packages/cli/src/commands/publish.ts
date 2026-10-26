import { canonicalTextOf, publishedSnapshotOf } from '@cf-loom/contract/internal';
import { type Run, runningGeneratorOf } from '../project/index.ts';
import type { Derived, DerivedVersion, DeriveOptions } from '../versioning/index.ts';
import { comparedLinesOf, notAboveOf, nothingToPublishOf, wouldPublishOf } from './check-lines.ts';
import { type Checked, endingOf } from './checked.ts';
import { checkedDocumentOf } from './checked-document.ts';
import { derivedCheckedOf } from './derivation.ts';
import { type Document, done, type Exit, toolingError } from './exit.ts';
import { type Prepared, preparedOf } from './prepared.ts';
import { type PublishMode, publishedPackageOf, type ToPublish } from './published-package.ts';

/** How `publish` was asked to run: publish even when nothing changed, as a prerelease of the version it derives, and stopping before `npm publish`. */
export type PublishOptions = DeriveOptions & { readonly dryRun: boolean };

/**
 * Publishes the package of the committed Snapshot through the organization's npm: checked against
 * its Baseline, failing on a refused Change, at the version its Changes and peer ranges derive,
 * with the Baseline's history merged in; it never waits on a Breaking Change Approval. A dry run
 * stages and builds the package and stops before `npm publish`.
 */
export async function publish(run: Run, options: PublishOptions): Promise<Exit> {
  const prepared = await preparedOf(run, undefined);
  if (prepared.kind === 'stopped') {
    return prepared.exit;
  }
  const checked = derivedCheckedOf(prepared, options);
  run.progress(comparedLinesOf(checked));
  const { derivation } = checked;
  switch (derivation.kind) {
    case 'refused': {
      const { stderr } = endingOf(checked.changes);
      return { status: 1, stdout: [], stderr, document: documentOf(checked, false) };
    }
    case 'against':
      throw new Error('publish compared with a version --against named: a bug.');
    case 'derived':
      return await derivedExit(run, { prepared, checked, options }, derivation.derived);
  }
}

/** What a publish whose check found no refused Change goes on with. */
type Publishing = {
  readonly prepared: Prepared;
  readonly checked: Checked;
  readonly options: PublishOptions;
};

/** The exit of a publish that derived: there is nothing to publish, the version would not be above the Baseline, or it puts the version. */
async function derivedExit(run: Run, publishing: Publishing, derived: Derived): Promise<Exit> {
  const { prepared, checked, options } = publishing;
  switch (derived.kind) {
    case 'unchanged': {
      const nothing = nothingToPublishOf(checked.packageName, derived.baseline);
      return done([`${nothing}; --force publishes anyway`], documentOf(checked, false));
    }
    case 'not-above':
      return toolingError(notAboveOf(checked.packageName, derived));
    case 'version': {
      const mode = options.dryRun ? 'dry-run' : 'publish';
      return await putExit(run, { prepared, checked, derived, mode });
    }
  }
}

/** The document of `check` with whether the package was put out. */
function documentOf(checked: Checked, published: boolean): Document {
  return { ...checkedDocumentOf(checked), published };
}

/** A publish that goes on: the comparison it was prepared from, what `check` reported of it, the version it derived and what it does with the built package. */
type Ready = {
  readonly prepared: Prepared;
  readonly checked: Checked;
  readonly derived: DerivedVersion;
  readonly mode: PublishMode;
};

async function putExit(run: Run, { prepared, checked, derived, mode }: Ready): Promise<Exit> {
  const { put, left } = await publishedPackageOf(run, toPublishOf(prepared, derived, mode));
  switch (put.kind) {
    case 'failed':
      return { status: 3, stdout: [], stderr: [put.message, ...left] };
    case 'published': {
      const published = `Published ${checked.packageName}@${derived.version}`;
      return { status: 0, stdout: [published], stderr: left, document: documentOf(checked, true) };
    }
    case 'built': {
      const would = wouldPublishOf(checked.packageName, derived);
      const stopped = `${would}: --dry-run stopped before npm publish`;
      return { status: 0, stdout: [stopped], stderr: left, document: documentOf(checked, false) };
    }
  }
}

/** The Snapshot as published at the derived version by the CLI that runs, with the Baseline's history merged in. */
function toPublishOf(
  { comparison, peerRanges }: Prepared,
  { version, tag }: DerivedVersion,
  mode: PublishMode,
): ToPublish {
  const { project, snapshot } = comparison.built;
  const baseline = comparison.kind === 'baseline' ? comparison.read.snapshot : undefined;
  const published = publishedSnapshotOf(baseline, snapshot, {
    version,
    generator: runningGeneratorOf(),
  });
  const highest = baseline?.version;
  const text = canonicalTextOf(published);
  const declared = comparison.built;
  return { mode, project, declared, published, text, peerRanges, tag, highest };
}
