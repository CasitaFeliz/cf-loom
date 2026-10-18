import { indentedCanonicalJson } from '../walker/index.ts';
import type { Snapshot } from './types.ts';

/**
 * A Snapshot's canonical form, the text `generate` writes as UTF-8 and `verify` compares: keys by
 * code point, two-space indentation and a final newline, so the same Contract gives the same bytes.
 */
export function canonicalTextOf(snapshot: Snapshot): string {
  return `${indentedCanonicalJson(snapshot)}\n`;
}
