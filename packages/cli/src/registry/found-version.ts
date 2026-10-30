import { type Failed, failed } from '../child-process/index.ts';
import type { Choice } from './against.ts';
import { jsonFromNpm, type NpmPlace, viewedFields } from './npm.ts';
import {
  type DeclaredPackage,
  type ExpectedSnapshot,
  expectedSnapshotOf,
  metadataFrom,
  type NotPublishedByCfLoom,
  type VersionMetadata,
} from './versions.ts';

/** A version that carries `cfLoom`, with the metadata read from it. */
export type Found = {
  readonly kind: 'found';
  readonly expected: ExpectedSnapshot;
  readonly metadata: VersionMetadata;
};

/** What a read of the candidates finds when none carries `cfLoom`. */
export type NoneFound = { readonly kind: 'none-found' };

/** Reads the metadata of what the Check chose, to find the version cf-loom published among it. */
export async function foundIn(
  npm: NpmPlace,
  choice: Choice,
  declaring: DeclaredPackage,
): Promise<Found | NoneFound | Failed> {
  switch (choice.kind) {
    case 'against':
      return await namedFoundIn(npm, choice.version, declaring);
    case 'baseline':
      return await firstFoundIn(npm, choice.candidates, declaring);
  }
}

/** The version `--against` names, which must carry `cfLoom`. */
async function namedFoundIn(
  npm: NpmPlace,
  version: string,
  declaring: DeclaredPackage,
): Promise<Found | Failed> {
  const expected = expectedSnapshotOf(version, declaring);
  const found = await foundAt(npm, expected);
  if (found.kind === 'not-cf-loom') {
    return failed(`${expected.spec} has no cfLoom: it was not published by cf-loom publish`);
  }
  return found;
}

/** The first candidate that carries `cfLoom`, since a version cf-loom did not publish is no Baseline. */
async function firstFoundIn(
  npm: NpmPlace,
  candidates: readonly string[],
  declaring: DeclaredPackage,
): Promise<Found | NoneFound | Failed> {
  for (const version of candidates) {
    const found = await foundAt(npm, expectedSnapshotOf(version, declaring));
    if (found.kind !== 'not-cf-loom') {
      return found;
    }
  }
  return { kind: 'none-found' };
}

async function foundAt(
  npm: NpmPlace,
  expected: ExpectedSnapshot,
): Promise<Found | NotPublishedByCfLoom | Failed> {
  const metadata = await metadataOf(npm, expected);
  return metadata.kind === 'metadata' ? { kind: 'found', expected, metadata } : metadata;
}

async function metadataOf(
  npm: NpmPlace,
  expected: ExpectedSnapshot,
): Promise<VersionMetadata | NotPublishedByCfLoom | Failed> {
  const { spec } = expected;
  const fields = ['version', 'cfLoom', 'peerDependencies', 'dist'];
  const call = { label: `npm view ${spec}`, args: ['view', spec, ...fields] };
  const run = await jsonFromNpm(npm, call, viewedFields);
  switch (run.kind) {
    case 'json':
      return metadataFrom(expected, run.value);
    case 'refused':
      return failed(run.message);
    case 'failed':
      return run;
  }
}
