import { type BuiltService, builtOf, isBuiltService, type Run } from '../project/index.ts';
import { type GeneratedFile, writeFiles } from '../writing/index.ts';
import { checkFailed, done, type Exit, failureExitOf, noJsonExitOf, toolingError } from './exit.ts';
import { noFileLinesOf, orphanLinesOf } from './handler-files.ts';
import { serviceFilesOf, snapshotFileOf } from './regenerated.ts';
import { stubsOf } from './stubs.ts';

/**
 * Writes the declared Snapshot to `contract.snapshot.json`, so every Contract change shows in
 * review; a Service also gets its Handler map, its readers and its missing Handlers' stubs.
 */
export async function generate(run: Run): Promise<Exit> {
  const built = await builtOf(run, 'running');
  if (built.kind !== 'built') {
    return failureExitOf(built);
  }
  const noJson = noJsonExitOf(built.committed);
  if (noJson !== undefined) {
    return noJson;
  }
  if (!isBuiltService(built)) {
    return writtenExit(run, [snapshotFileOf(built)]);
  }
  return await generateService(run, built);
}

/**
 * A Service's files, or every line that stops them: a name the readers cannot write, an Element
 * no stub could import, a Handler file nothing names, a Handler path that is no file.
 */
async function generateService(run: Run, service: BuiltService): Promise<Exit> {
  const regenerated = serviceFilesOf(service);
  if (regenerated.kind === 'unnamed') {
    return toolingError(regenerated.line);
  }
  const stubs = await stubsOf(service);
  if (stubs.kind === 'tooling') {
    return toolingError(stubs.message);
  }
  const orphans = orphanLinesOf(service);
  if (orphans.kind === 'tooling') {
    return toolingError(orphans.message);
  }
  const failures = [...stubs.failureLines, ...noFileLinesOf(service), ...orphans.lines];
  if (failures.length > 0) {
    return checkFailed(failures);
  }
  const files = [snapshotFileOf(service), ...regenerated.files, ...stubs.stubs];
  return writtenExit(run, files);
}

function writtenExit(run: Run, files: readonly GeneratedFile[]): Exit {
  const written = writeFiles(run.cwd, files);
  if (written.kind === 'failed') {
    return toolingError(written.message);
  }
  return done(written.paths.map((path) => `Wrote ${path}`));
}
