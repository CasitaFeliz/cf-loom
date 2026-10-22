import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { ownOf } from '@cf-loom/contract/internal';
import { type Failed, failed, jsonFromNpm, type NpmPlace } from './npm.ts';
import { entriesNamed } from './tar-entries.ts';

const maxTarballBytes = 64 * 1024 * 1024;
const snapshotFile = 'snapshot.json';

/** The text of the `snapshot.json` inside a package's tarball. */
export type SnapshotText = { readonly kind: 'text'; readonly text: string };

/**
 * Downloads a package's tarball with `npm pack`, which checks its integrity, and reads its single
 * `snapshot.json` as strict UTF-8; the folder it packs into is removed whatever happens.
 */
export async function snapshotTextOf(
  place: NpmPlace,
  spec: string,
): Promise<SnapshotText | Failed> {
  try {
    const folder = await mkdtemp(join(tmpdir(), 'cf-loom-baseline-'));
    try {
      return await textPacked(place, spec, folder);
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  } catch (e) {
    const cause = e instanceof Error ? e.message : String(e);
    return failed(`${spec}'s tarball cannot be read: ${cause}`);
  }
}

async function textPacked(
  place: NpmPlace,
  spec: string,
  folder: string,
): Promise<SnapshotText | Failed> {
  const label = `npm pack ${spec}`;
  const packed = await jsonFromNpm(place, {
    label,
    args: ['pack', spec, '--pack-destination', folder],
  });
  if (packed.kind !== 'json') {
    return packed.kind === 'refused' ? failed(packed.message) : packed;
  }
  const filename = filenameOf(packed.value);
  if (filename === undefined) {
    return failed(`${label} printed no tarball`);
  }
  const file = join(folder, filename);
  if ((await stat(file)).size > maxTarballBytes) {
    return unreadable(spec, 'is larger than 64 MiB');
  }
  return textIn(spec, await readFile(file));
}

function filenameOf(printed: unknown): string | undefined {
  const [first] = Array.isArray(printed) ? printed : [];
  const filename = ownOf(first, 'filename');
  return typeof filename === 'string' && filename !== '' && basename(filename) === filename
    ? filename
    : undefined;
}

function textIn(spec: string, tarball: Buffer): SnapshotText | Failed {
  const archive = gunzipped(tarball);
  if (archive.kind === 'failed') {
    return unreadable(spec, archive.reason);
  }
  const found = entriesNamed(archive.bytes, snapshotFile);
  if (found.kind === 'broken') {
    return unreadable(spec, found.reason);
  }
  const [contents, ...more] = found.contents;
  if (contents === undefined) {
    return failed(`${spec} has no ${snapshotFile}`);
  }
  if (more.length > 0) {
    return failed(`${spec} has more than one ${snapshotFile}`);
  }
  return utf8Of(spec, contents);
}

function gunzipped(
  tarball: Buffer,
): { kind: 'gunzipped'; bytes: Buffer } | { kind: 'failed'; reason: string } {
  try {
    return { kind: 'gunzipped', bytes: gunzipSync(tarball, { maxOutputLength: maxTarballBytes }) };
  } catch (e) {
    const isTooLarge = e instanceof RangeError;
    return { kind: 'failed', reason: isTooLarge ? 'is larger than 64 MiB unpacked' : 'is no gzip' };
  }
}

function utf8Of(spec: string, bytes: Buffer): SnapshotText | Failed {
  try {
    return { kind: 'text', text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) };
  } catch {
    return failed(`${spec}'s ${snapshotFile} is no UTF-8 text`);
  }
}

function unreadable(spec: string, reason: string): Failed {
  return failed(`${spec}'s tarball cannot be read: ${reason}`);
}
