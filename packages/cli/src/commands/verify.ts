import { declaredSnapshotOf, snapshotFile } from './declared.ts';
import { checkFailed, done, type Exit, type Run } from './exit.ts';

/**
 * Fails when `contract.snapshot.json` is not what `generate` would write, edited by hand or left
 * behind by a Contract change, so review never reads a stale Snapshot; which CLI wrote it does
 * not count.
 */
export async function verify(run: Run): Promise<Exit> {
  const declared = await declaredSnapshotOf(run, 'committed');
  if (declared.kind === 'stopped') {
    return declared.exit;
  }
  const { committed } = declared;
  switch (committed.kind) {
    case 'none':
      return checkFailed([`${snapshotFile} is missing: run cf-loom generate`]);
    case 'no-json':
      return checkFailed([`${snapshotFile} was edited: it is no JSON (${committed.reason})`]);
    case 'json':
      return declared.bytes.equals(committed.bytes)
        ? done(`${snapshotFile} is up to date`)
        : checkFailed([`${snapshotFile} was edited or is out of date: run cf-loom generate`]);
  }
}
