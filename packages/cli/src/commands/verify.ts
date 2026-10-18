import { Buffer } from 'node:buffer';
import { declaredSnapshotOf, snapshotFile } from './declared.ts';
import { checkFailed, done, type Exit, type Run } from './exit.ts';

/**
 * Fails when `contract.snapshot.json` is not what `generate` would write now, edited by hand or
 * left behind by a Contract change, so review never reads a stale Snapshot.
 */
export async function verify(run: Run): Promise<Exit> {
  const declared = await declaredSnapshotOf(run);
  if (declared.kind === 'stopped') {
    return declared.exit;
  }
  if (declared.committed === undefined) {
    return checkFailed([`${snapshotFile} is missing: run cf-loom generate`]);
  }
  if (!Buffer.from(declared.bytes).equals(declared.committed)) {
    return checkFailed([`${snapshotFile} was edited or is out of date: run cf-loom generate`]);
  }
  return done(`${snapshotFile} is up to date`);
}
