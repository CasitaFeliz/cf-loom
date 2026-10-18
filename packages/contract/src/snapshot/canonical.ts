import { indentedCanonicalJson } from '../walker/index.ts';
import type { Snapshot } from './types.ts';

/** Every runtime this package runs on has `TextEncoder`; it builds without DOM or Node types. */
declare const TextEncoder: new () => { encode(text: string): Uint8Array };

/**
 * A Snapshot's canonical form, the bytes `generate` writes and `verify` compares: UTF-8 JSON, keys
 * by code point, two-space indentation and a final newline, so the same Contract gives the same bytes.
 */
export function canonicalBytes(snapshot: Snapshot): Uint8Array {
  return new TextEncoder().encode(`${indentedCanonicalJson(snapshot)}\n`);
}
