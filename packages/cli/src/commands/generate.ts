import { builtOf, snapshotFile } from './built.ts';
import { checkFailed, done, type Exit, type Run, toolingError } from './exit.ts';
import { orphanLinesOf, regeneratedFilesOf, stubsOf } from './generated-files.ts';
import { writeFiles } from './writing.ts';

/**
 * Writes the declared Snapshot to `contract.snapshot.json`, so every Contract change shows in
 * review, and for a Service its handler map, its readers and the stub of every missing Handler;
 * a committed file that is no JSON is left for its author to restore or delete.
 */
export async function generate(run: Run): Promise<Exit> {
  const built = await builtOf(run, 'running');
  if (built.kind === 'stopped') {
    return built.exit;
  }
  if (built.committed.kind === 'no-json') {
    const reason = built.committed.reason;
    return toolingError(
      `${snapshotFile} is no JSON (${reason}): restore it or delete it, then run cf-loom generate`,
    );
  }
  const stubs = await stubsOf(built);
  if (stubs.kind === 'stopped') {
    return stubs.exit;
  }
  const failures = [...stubs.unexportedLines, ...orphanLinesOf(built)];
  if (failures.length > 0) {
    return checkFailed(failures);
  }
  const written = writeFiles(run.cwd, [...regeneratedFilesOf(built), ...stubs.stubs]);
  if (written.kind === 'stopped') {
    return written.exit;
  }
  return done(written.paths.map((path) => `Wrote ${path}`));
}
