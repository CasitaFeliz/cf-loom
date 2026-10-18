import { type BuiltService, builtOf, isBuiltService } from './built.ts';
import { checkFailed, done, type Exit, type Run } from './exit.ts';
import { noFileLinesOf, orphanLinesOf, serviceFilesOf, snapshotFileOf } from './handler-files.ts';
import { stubsOf } from './stubs.ts';
import { type GeneratedFile, writeFiles } from './writing.ts';

/**
 * Writes the declared Snapshot to `contract.snapshot.json`, so every Contract change shows in
 * review; a Service also gets its Handler map, its readers and its missing Handlers' stubs.
 */
export async function generate(run: Run): Promise<Exit> {
  const built = await builtOf(run, 'running');
  if (built.kind === 'stopped') {
    return built.exit;
  }
  if (!isBuiltService(built)) {
    return writtenExit(run, [snapshotFileOf(built)]);
  }
  return await generateService(run, built);
}

/**
 * A Service's files, or every line that stops them: an Element no stub could import, a Handler
 * file nothing names, a Handler path that is no file.
 */
async function generateService(run: Run, service: BuiltService): Promise<Exit> {
  const stubs = await stubsOf(service);
  if (stubs.kind === 'stopped') {
    return stubs.exit;
  }
  const failures = [...stubs.failureLines, ...noFileLinesOf(service), ...orphanLinesOf(service)];
  if (failures.length > 0) {
    return checkFailed(failures);
  }
  const files = [snapshotFileOf(service), ...serviceFilesOf(service), ...stubs.stubs];
  return writtenExit(run, files);
}

function writtenExit(run: Run, files: readonly GeneratedFile[]): Exit {
  const written = writeFiles(run.cwd, files);
  if (written.kind === 'stopped') {
    return written.exit;
  }
  return done(written.paths.map((path) => `Wrote ${path}`));
}
