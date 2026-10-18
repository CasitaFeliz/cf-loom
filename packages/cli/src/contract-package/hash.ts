import { createHash } from 'node:crypto';
import { hashedTextOf, type Snapshot } from '@casitafeliz/loom-contract/internal';

/**
 * The Snapshot's hash, as `cfLoom.snapshotHash` carries it: the SHA-256 of its canonical text
 * without `version` and `generator`, in lowercase hex.
 */
export function snapshotHashOf(snapshot: Snapshot): string {
  return createHash('sha256').update(hashedTextOf(snapshot), 'utf8').digest('hex');
}
