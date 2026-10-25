import { Buffer } from 'node:buffer';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { snapshotFormatOf } from '@cf-loom/contract/internal';
import { newerFormatTextOf, oneLineOf } from '../loading/index.ts';
import { type Tooling, tooling } from './failures.ts';

/** The file `generate` writes the declared Snapshot to, next to `cf-loom.config.ts`. */
export const snapshotFile = 'contract.snapshot.json';

/** The committed `contract.snapshot.json` as read: none, its bytes and their JSON, or no JSON. */
export type Committed =
  | { readonly kind: 'none' }
  | { readonly kind: 'json'; readonly bytes: Buffer; readonly parsed: unknown }
  | { readonly kind: 'no-json'; readonly reason: string };

/**
 * The committed `contract.snapshot.json` as read, or the tooling error of a file that cannot be,
 * a format newer than this cf-loom reads included.
 */
export function committedOf(directory: string): Committed | Tooling {
  const path = join(directory, snapshotFile);
  if (!existsSync(path)) {
    return { kind: 'none' };
  }
  const bytes = bytesOf(path, directory);
  if (!Buffer.isBuffer(bytes)) {
    return bytes;
  }
  try {
    return jsonOf(bytes, JSON.parse(bytes.toString('utf8')));
  } catch (e) {
    return { kind: 'no-json', reason: oneLineOf(e, directory) };
  }
}

/** The committed JSON, unless it names a format newer than this cf-loom reads. */
function jsonOf(bytes: Buffer, parsed: unknown): Committed | Tooling {
  const format = snapshotFormatOf(parsed);
  if (format.kind === 'newer-format') {
    return tooling(newerFormatTextOf(snapshotFile, format.format));
  }
  return { kind: 'json', bytes, parsed };
}

function bytesOf(path: string, directory: string): Buffer | Tooling {
  try {
    return readFileSync(path);
  } catch (e) {
    return tooling(`${snapshotFile} cannot be read: ${oneLineOf(e, directory)}`);
  }
}
