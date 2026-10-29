import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Failed, failed } from '../child-process/index.ts';
import type { NpmPlace } from './npm.ts';
import {
  type PackedTarball,
  type PublishedIn,
  packedTarballOf,
  publishedSnapshotIn,
  unreadable,
} from './published-tarball.ts';
import type { ExpectedSnapshot } from './versions.ts';

/** A version of a package in the registry: the Snapshot its tarball must hold, and the sha512 digests it must hash to. */
export type Download = { readonly expected: ExpectedSnapshot; readonly digests: readonly string[] };

/**
 * Downloads a package's tarball with `npm pack`, requires its bytes to hash to one of the sha512
 * digests `npm view` listed, and reads its published Snapshot; the folder it packs into is
 * removed on a best-effort basis.
 */
export async function downloadedSnapshotOf(
  npm: NpmPlace,
  download: Download,
): Promise<PublishedIn | Failed> {
  const { spec } = download.expected;
  let folder: string;
  try {
    folder = await mkdtemp(join(tmpdir(), 'cf-loom-baseline-'));
  } catch (e) {
    return unreadable(spec, e instanceof Error ? e.message : String(e));
  }
  try {
    return await snapshotPacked(npm, download, folder);
  } finally {
    await removeFolderBestEffort(folder);
  }
}

/** Removing the folder is best effort: a leftover in the system's temporary folder fails no read. */
async function removeFolderBestEffort(folder: string): Promise<void> {
  await rm(folder, { recursive: true, force: true }).catch(() => undefined);
}

async function snapshotPacked(
  npm: NpmPlace,
  { expected, digests }: Download,
  folder: string,
): Promise<PublishedIn | Failed> {
  const { spec } = expected;
  const packed = await packedTarballOf(npm, { spec, target: spec }, folder);
  if (packed.kind === 'failed') {
    return packed;
  }
  if (!digests.includes(sha512Of(packed))) {
    return failed(`${spec}'s tarball does not match the sha512 integrity npm view lists`);
  }
  return publishedSnapshotIn(packed.bytes, expected);
}

function sha512Of({ bytes }: PackedTarball): string {
  return createHash('sha512').update(bytes).digest('base64');
}
