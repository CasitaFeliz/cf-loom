import { existsSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { oneLineOf } from '../loading/index.ts';
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

/**
 * Writes the Snapshot beside the committed file and renames it over it, so a failed write leaves
 * the committed file as it was; the temporary file a failure leaves is removed.
 */
function written(cwd: string, bytes: Uint8Array): Exit {
  const path = join(cwd, snapshotFile);
  const temporary = `${path}.tmp`;
  try {
    writeFileSync(temporary, bytes);
    renameSync(temporary, path);
    return done(`Wrote ${snapshotFile}`);
  } catch (e) {
    removeFile(temporary);
    return toolingError(`${snapshotFile} cannot be written: ${oneLineOf(e, cwd)}`);
  }
}

/** Removes a file the write left; what is no file there is not the write's and stays. */
function removeFile(path: string): void {
  if (existsSync(path) && statSync(path).isFile()) {
    rmSync(path);
  }
}
