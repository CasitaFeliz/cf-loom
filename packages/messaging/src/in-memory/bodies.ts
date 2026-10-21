import { jsonOfBytes } from '@cf-loom/contract/internal';

/** The JSON value of a body's bytes, which the core wrote as UTF-8 JSON, so any other is a bug. */
export function jsonBodyOf(bytes: Uint8Array): unknown {
  const json = jsonOfBytes(bytes);
  if (json.kind === 'malformed') {
    throw new Error('A body the core wrote is UTF-8 JSON');
  }
  return json.value;
}
