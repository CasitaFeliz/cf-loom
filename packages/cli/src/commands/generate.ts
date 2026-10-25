import { contractExportsOf } from '../loading/index.ts';
import { type BuiltService, builtOf, isBuiltService, type Run } from '../project/index.ts';
import {
  deleteFiles,
  type FileMove,
  type GeneratedFile,
  moveFiles,
  writeFiles,
} from '../writing/index.ts';
import { checkFailed, done, type Exit, failureExitOf, noJsonExitOf, toolingError } from './exit.ts';
import { noFileLinesOf, placedOf } from './handler-files.ts';
import { recordOf } from './record.ts';
import { serviceFilesOf, snapshotFileOf } from './regenerated.ts';
import { stubsOf } from './stubs.ts';
import { unreachedLinesOf } from './unreached.ts';

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
    return writtenExit(run, { moves: [], stale: [] }, [snapshotFileOf(built)]);
  }
  return await generateService(run, built);
}

/**
 * A Service's files, or every line that stops them: a Handler path under `src/contract/` or two
 * Elements at one, an Element no stub or the readers could import, a file nothing names, a
 * Handler path that is no file.
 */
async function generateService(run: Run, built: BuiltService): Promise<Exit> {
  const service = placedOf(built);
  if (service.kind === 'tooling') {
    return toolingError(service.message);
  }
  const exports = await contractExportsOf(service.project.directory);
  if (exports.kind === 'failed') {
    return toolingError(exports.message);
  }
  const regenerated = serviceFilesOf(service, exports.exportsOf);
  const record = recordOf(service);
  if (record.kind === 'tooling') {
    return toolingError(record.message);
  }
  const stubs = stubsOf(service, exports.exportsOf, record.lacking);
  const failures = [
    ...stubs.failureLines,
    ...regenerated.failureLines,
    ...unreachedLinesOf(service, exports.exports),
    ...noFileLinesOf(service),
    ...record.lines,
  ];
  if (failures.length > 0) {
    return checkFailed(failures);
  }
  const moved = moveFiles(run.cwd, record.moves);
  if (moved.kind === 'failed') {
    return toolingError(moved.message);
  }
  const files = [snapshotFileOf(service), ...regenerated.files, ...stubs.stubs];
  return writtenExit(run, { moves: moved.moves, stale: record.stale }, files);
}

/** What `generate` does besides writing: the Handlers it moves and the stale files it deletes. */
type Changes = { readonly moves: readonly FileMove[]; readonly stale: readonly string[] };

/** Writes the files, then deletes the stale ones, so no file is deleted before its replacement is written. */
function writtenExit(run: Run, { moves, stale }: Changes, files: readonly GeneratedFile[]): Exit {
  const movedLines = moves.map(({ from, to }) => `Moved ${from} to ${to}`);
  const written = writeFiles(run.cwd, files);
  if (written.kind === 'failed') {
    return { ...toolingError(written.message), stdout: movedLines };
  }
  const deleted = deleteFiles(run.cwd, stale);
  if (deleted.kind === 'failed') {
    return { ...toolingError(deleted.message), stdout: movedLines };
  }
  return done([
    ...movedLines,
    ...written.paths.map((path) => `Wrote ${path}`),
    ...deleted.paths.map((path) => `Deleted ${path}`),
  ]);
}
