import { indentedCanonicalJson } from '../walker/index.ts';
import type { PackagedSnapshot, PublishedSnapshot } from './published.ts';
import type { Snapshot } from './types.ts';

/** The keys every Snapshot starts with, in this order; a declared one holds the first three. */
const snapshotHeadingKeys = ['format', 'kind', 'name', 'version', 'generator'] as const;

/** Every Snapshot a file holds: the declared one, the one `package` writes and the published one. */
type FileSnapshot = Snapshot | PackagedSnapshot | PublishedSnapshot;

/**
 * A Snapshot's canonical form, the text `generate` writes as UTF-8 and `verify` compares: the
 * heading first, the other keys by code point, two-space indentation and a final newline, so the
 * same Contract gives the same bytes.
 */
export function canonicalTextOf(snapshot: FileSnapshot): string {
  return canonicalFormOf(snapshot);
}

/**
 * A Snapshot as its canonical text reads back, every map in code point order, so whatever is
 * generated from it in order is a function of the canonical Snapshot alone. `JSON.parse`'s result
 * is trusted as `Read`, since it is the text of that very Snapshot.
 */
export function canonicalSnapshotOf<Read extends FileSnapshot>(snapshot: Read): Read {
  return JSON.parse(canonicalFormOf(snapshot));
}

/**
 * The canonical text a Snapshot's hash is taken of: the canonical form without `version` and
 * `generator`, so a publish or a new CLI alone never changes it.
 */
export function hashedTextOf(
  snapshot: FileSnapshot & { readonly version?: string; readonly generator?: string },
): string {
  const { generator: _generator, version: _version, ...hashed } = snapshot;
  return canonicalFormOf(hashed);
}

function canonicalFormOf(value: unknown): string {
  return `${indentedCanonicalJson(value, snapshotHeadingKeys)}\n`;
}
