import { readFile, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import {
  decodeSnapshot,
  ownOf,
  type PublishedSnapshot,
  problemLineOf,
} from '@cf-loom/contract/internal';
import { type Failed, failed } from '../child-process/index.ts';
import { newerFormatTextOf } from '../loading/index.ts';
import { jsonFromNpm, type NpmPlace, packedOf } from './npm.ts';
import { fileNamed } from './tar-entries.ts';
import type { ExpectedSnapshot } from './versions.ts';

const maxTarballBytes = 64 * 1024 * 1024;
const snapshotFile = 'snapshot.json';

/** What `npm pack` is given, and what the package is called in a line: a version's spec in the registry, or a staged folder with the spec it will have. */
export type PackTarget = { readonly spec: string; readonly target: string };

/** A tarball `npm pack` wrote, where it is and its bytes. */
export type PackedTarball = {
  readonly kind: 'packed';
  readonly file: string;
  readonly bytes: Buffer;
};

/** The published Snapshot a tarball holds. */
export type PublishedIn = { readonly kind: 'snapshot'; readonly snapshot: PublishedSnapshot };

/** Why a tarball cannot be read, in the words every line about it uses. */
export function unreadable(spec: string, reason: string): Failed {
  return failed(`${spec}'s tarball cannot be read: ${reason}`);
}

/**
 * Packs a registry version or a staged folder into one tarball in `folder` through the
 * organization's npm, with no lifecycle script, and reads its bytes; one over 64 MiB is refused.
 */
export async function packedTarballOf(
  npm: NpmPlace,
  { spec, target }: PackTarget,
  folder: string,
): Promise<PackedTarball | Failed> {
  const label = `npm pack ${spec}`;
  const args = ['pack', target, '--pack-destination', folder, '--ignore-scripts'];
  const run = await jsonFromNpm(npm, { label, args });
  switch (run.kind) {
    case 'json': {
      const filename = filenameOf(run.value);
      return filename === undefined
        ? failed(`${label} printed no tarball`)
        : await tarballAt(spec, join(folder, filename));
    }
    case 'refused':
      return failed(run.message);
    case 'failed':
      return run;
  }
}

/**
 * The published Snapshot in a package's tarball as `check` reads a Baseline: the one
 * `snapshot.json` as strict UTF-8, decoded, and of the name, kind and version it expects.
 */
export function publishedSnapshotIn(
  tarball: Buffer,
  expected: ExpectedSnapshot,
): PublishedIn | Failed {
  const text = snapshotTextIn(expected.spec, tarball);
  return text.kind === 'failed' ? text : snapshotFrom(expected, text.text);
}

function filenameOf(printed: unknown): string | undefined {
  const filename = ownOf(packedOf(printed), 'filename');
  return typeof filename === 'string' && filename !== '' && basename(filename) === filename
    ? filename
    : undefined;
}

async function tarballAt(spec: string, file: string): Promise<PackedTarball | Failed> {
  try {
    const { size } = await stat(file);
    if (size > maxTarballBytes) {
      return unreadable(spec, 'is larger than 64 MiB');
    }
    return { kind: 'packed', file, bytes: await readFile(file) };
  } catch (e) {
    return unreadable(spec, e instanceof Error ? e.message : String(e));
  }
}

function snapshotTextIn(
  spec: string,
  tarball: Buffer,
): { readonly kind: 'text'; readonly text: string } | Failed {
  const archive = gunzipped(tarball);
  if (archive.kind === 'failed') {
    return unreadable(spec, archive.reason);
  }
  const found = fileNamed(archive.bytes, snapshotFile);
  switch (found.kind) {
    case 'broken':
      return unreadable(spec, found.reason);
    case 'missing':
      return failed(`${spec} has no ${snapshotFile}`);
    case 'repeated':
      return failed(`${spec} has more than one ${snapshotFile}`);
    case 'found':
      return utf8Of(spec, found.contents);
  }
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

function utf8Of(
  spec: string,
  bytes: Buffer,
): { readonly kind: 'text'; readonly text: string } | Failed {
  try {
    return { kind: 'text', text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) };
  } catch {
    return failed(`${spec}'s ${snapshotFile} is no UTF-8 text`);
  }
}

function snapshotFrom(expected: ExpectedSnapshot, text: string): PublishedIn | Failed {
  const { spec, version, declared } = expected;
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
      const isExpected =
        snapshot.name === declared.name &&
        snapshot.kind === declared.kind &&
        snapshot.version === version;
      const found = `${snapshot.name}@${snapshot.version} (${snapshot.kind})`;
      return isExpected
        ? { kind: 'snapshot', snapshot }
        : failed(`${spec}'s snapshot.json is ${found}, not ${spec}`);
    }
  }
}
