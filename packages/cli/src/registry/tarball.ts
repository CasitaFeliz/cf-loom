import { createHash } from 'node:crypto';
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

/** The tarball of a package version: its spec, and the sha512 digests it must hash to. */
export type Tarball = { readonly spec: string; readonly digests: readonly string[] };

type Done<Value> = { readonly kind: 'done'; readonly value: Value };

type Unreadable = { readonly kind: 'unreadable'; readonly reason: string };

/**
 * Downloads a package's tarball with `npm pack`, requires its bytes to hash to one of the sha512
 * digests `npm view` listed, and reads its single `snapshot.json` as strict UTF-8; the folder it
 * packs into is removed whatever happens.
 */
export async function snapshotTextOf(
  place: NpmPlace,
  tarball: Tarball,
): Promise<SnapshotText | Failed> {
  const { spec } = tarball;
  const made = await attempt(() => mkdtemp(join(tmpdir(), 'cf-loom-baseline-')));
  if (made.kind === 'unreadable') {
    return unreadable(spec, made.reason);
  }
  try {
    return await textPacked(place, tarball, made.value);
  } finally {
    await removed(made.value);
  }
}

async function attempt<Value>(step: () => Promise<Value>): Promise<Done<Value> | Unreadable> {
  try {
    return { kind: 'done', value: await step() };
  } catch (e) {
    return { kind: 'unreadable', reason: e instanceof Error ? e.message : String(e) };
  }
}

/** Removing the folder is best effort: a leftover in the system's temporary folder fails no read. */
async function removed(folder: string): Promise<void> {
  await rm(folder, { recursive: true, force: true }).catch(() => undefined);
}

async function textPacked(
  place: NpmPlace,
  { spec, digests }: Tarball,
  folder: string,
): Promise<SnapshotText | Failed> {
  const packed = await packedInto(place, spec, folder);
  if (packed.kind === 'failed') {
    return packed;
  }
  const read = await tarballAt(packed.file);
  if (read.kind === 'unreadable') {
    return unreadable(spec, read.reason);
  }
  const digest = createHash('sha512').update(read.value).digest('base64');
  if (!digests.includes(digest)) {
    return failed(`${spec}'s tarball does not match the sha512 integrity npm view lists`);
  }
  return textIn(spec, read.value);
}

async function packedInto(
  place: NpmPlace,
  spec: string,
  folder: string,
): Promise<{ readonly kind: 'packed'; readonly file: string } | Failed> {
  const label = `npm pack ${spec}`;
  const args = ['pack', spec, '--pack-destination', folder];
  const run = await jsonFromNpm(place, { label, args });
  switch (run.kind) {
    case 'json': {
      const filename = filenameOf(run.value);
      return filename === undefined
        ? failed(`${label} printed no tarball`)
        : { kind: 'packed', file: join(folder, filename) };
    }
    case 'refused':
      return failed(run.message);
    case 'failed':
      return run;
  }
}

function filenameOf(printed: unknown): string | undefined {
  const [first] = Array.isArray(printed) ? printed : [];
  const filename = ownOf(first, 'filename');
  return typeof filename === 'string' && filename !== '' && basename(filename) === filename
    ? filename
    : undefined;
}

async function tarballAt(file: string): Promise<Done<Buffer> | Unreadable> {
  const size = await attempt(async () => (await stat(file)).size);
  if (size.kind === 'unreadable') {
    return size;
  }
  if (size.value > maxTarballBytes) {
    return { kind: 'unreadable', reason: 'is larger than 64 MiB' };
  }
  return await attempt(() => readFile(file));
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
