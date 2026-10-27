import { type Failed, failed } from '../child-process/index.ts';
import type { Choice } from './against.ts';
import { jsonFromNpm, type NpmPlace } from './npm.ts';
import {
  type BaselineSource,
  metadataFrom,
  type NotPublishedByCfLoom,
  type VersionMetadata,
} from './versions.ts';

/** A version that carries `cfLoom`, with the metadata read from it. */
export type Found = {
  readonly kind: 'found';
  readonly source: BaselineSource;
  readonly metadata: VersionMetadata;
};

/** What a read of the candidates finds when none carries `cfLoom`. */
export type NoneFound = { readonly kind: 'none-found' };

/** The package and declared Snapshot a version's metadata is read for. */
type DeclaredPackage = {
  readonly packageName: string;
  readonly declared: BaselineSource['declared'];
};

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
  const source = sourceOf(version, declaring);
  const found = await foundAt(npm, source);
  if (found.kind === 'not-cf-loom') {
    return failed(`${source.spec} has no cfLoom: it was not published by cf-loom publish`);
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
    const found = await foundAt(npm, sourceOf(version, declaring));
    if (found.kind !== 'not-cf-loom') {
      return found;
    }
  }
  return { kind: 'none-found' };
}

function sourceOf(version: string, { packageName, declared }: DeclaredPackage): BaselineSource {
  return { spec: `${packageName}@${version}`, version, declared };
}

async function foundAt(
  npm: NpmPlace,
  source: BaselineSource,
): Promise<Found | NotPublishedByCfLoom | Failed> {
  const metadata = await metadataOf(npm, source);
  return metadata.kind === 'metadata' ? { kind: 'found', source, metadata } : metadata;
}

async function metadataOf(
  npm: NpmPlace,
  source: BaselineSource,
): Promise<VersionMetadata | NotPublishedByCfLoom | Failed> {
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
