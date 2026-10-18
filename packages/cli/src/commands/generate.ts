import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { declaredSnapshotOf, snapshotFile } from './declared.ts';
import { done, type Exit, type Run } from './exit.ts';

/** Writes the declared Snapshot to `contract.snapshot.json`, so every Contract change shows in review. */
export async function generate(run: Run): Promise<Exit> {
  const declared = await declaredSnapshotOf(run);
  if (declared.kind === 'stopped') {
    return declared.exit;
  }
  writeFileSync(join(run.cwd, snapshotFile), declared.bytes);
  return done(`Wrote ${snapshotFile}`);
}
