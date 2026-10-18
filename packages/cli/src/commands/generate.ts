import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { thrownLineOf } from '../loading/index.ts';
import { declaredSnapshotOf, snapshotFile } from './declared.ts';
import { done, type Exit, type Run, toolingError } from './exit.ts';

/**
 * Writes the declared Snapshot to `contract.snapshot.json`, so every Contract change shows in
 * review; a committed file that is no JSON is left for its author to restore or delete.
 */
export async function generate(run: Run): Promise<Exit> {
  const declared = await declaredSnapshotOf(run, 'running');
  if (declared.kind === 'stopped') {
    return declared.exit;
  }
  if (declared.committed.kind === 'no-json') {
    const reason = declared.committed.reason;
    return toolingError(
      `${snapshotFile} is no JSON (${reason}): restore it or delete it, then run cf-loom generate`,
    );
  }
  return written(run.cwd, declared.bytes);
}

function written(cwd: string, bytes: Uint8Array): Exit {
  try {
    writeFileSync(join(cwd, snapshotFile), bytes);
    return done(`Wrote ${snapshotFile}`);
  } catch (e) {
    return toolingError(`${snapshotFile} cannot be written: ${thrownLineOf(e, cwd)}`);
  }
}
