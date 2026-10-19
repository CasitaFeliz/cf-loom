import { indentedCanonicalJson } from '../walker/index.ts';
import type { Snapshot } from './types.ts';

/**
 * A Snapshot's canonical form, the text `generate` writes as UTF-8 and `verify` compares: keys by
 * code point, two-space indentation and a final newline, so the same Contract gives the same bytes.
 */
export function canonicalTextOf(snapshot: Snapshot): string {
  return canonicalFormOf(snapshot);
}

/**
 * A Snapshot as its canonical text reads back, every map in code point order, so whatever is
 * generated from it in order is a function of the canonical Snapshot alone. `JSON.parse`'s result
 * is trusted as `Read`, since it is the text of that very Snapshot.
 */
export function canonicalSnapshotOf<Read extends Snapshot>(snapshot: Read): Read {
  return JSON.parse(canonicalFormOf(snapshot));
}

/**
 * The canonical text a Snapshot's hash is taken of: the canonical form without `version` and
 * `generator`, so a publish or a new CLI alone never changes it.
 */
export function hashedTextOf(snapshot: Snapshot & { readonly version?: string }): string {
  const { generator: _generator, version: _version, ...hashed } = snapshot;
  return canonicalFormOf(hashed);
}

function canonicalFormOf(value: unknown): string {
  return `${indentedCanonicalJson(value)}\n`;
}
