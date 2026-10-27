import { contractExportsOf } from '../loading/index.ts';
import { type BuiltService, builtOf, isBuiltService } from '../project/index.ts';
import {
  deleteFiles,
  type FileMove,
  type GeneratedFile,
  moveFiles,
  writeFiles,
} from '../writing/index.ts';
import { checkFailed, done, type Exit, failureExitOf, toolingError } from './exit.ts';
import { noFileLinesOf, placedOf } from './handler-files.ts';
import { recordOf } from './record.ts';
import { serviceFilesOf, snapshotFileOf } from './regenerated.ts';
import type { Run } from './run.ts';
import { stubsOf } from './stubs.ts';
import { unreachedLinesOf } from './unreached.ts';

/**
 * Writes the declared Snapshot to `contract.snapshot.json`, so every Contract change shows in
 * review; a Service also gets its Handler map, its readers and its missing Handlers' Stubs.
 */
export async function generate(run: Run): Promise<Exit> {
  const built = await builtOf(run.cwd);
  if (built.kind !== 'built') {
    return failureExitOf(built);
  }
  if (!isBuiltService(built)) {
    return appliedExit(run, { moves: [], stale: [] }, [snapshotFileOf(built)]);
  }
  return await generateService(run, built);
}

/**
 * A Service's files, or every line that stops them: a Handler path under `src/contract/` or two
 * declarations at one, a declaration no Stub or the readers could import, a file nothing names, a
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
  return appliedExit(run, { moves: moved.moves, stale: record.stale }, files);
}

/** What `generate` does besides writing: the Handlers it moves and the stale files it deletes. */
type Changes = { readonly moves: readonly FileMove[]; readonly stale: readonly string[] };

/** The exit of the changes `generate` applies, in an order that deletes no file before its replacement is written. */
function appliedExit(run: Run, { moves, stale }: Changes, files: readonly GeneratedFile[]): Exit {
  run.report({ lines: movedLinesOf(moves), fields: { moved: movedOf(moves) } });
  const written = writeFiles(run.cwd, files);
  const wrote = written.paths.map((path) => `Wrote ${path}`);
  run.report({ lines: wrote, fields: { wrote: written.paths } });
  if (written.kind === 'failed') {
    return toolingError(written.message);
  }
  const deleted = deleteFiles(run.cwd, stale);
  const removed = deleted.paths.map((path) => `Deleted ${path}`);
  run.report({ lines: removed, fields: { deleted: deleted.paths } });
  return deleted.kind === 'failed' ? toolingError(deleted.message) : done([], {});
}

/** The moves as the document names them, by where each Handler was and is. */
function movedOf(moves: readonly FileMove[]): readonly FileMove[] {
  return moves.map(({ from, to }) => ({ from, to }));
}

function movedLinesOf(moves: readonly FileMove[]): readonly string[] {
  return moves.map(({ from, to }) => `Moved ${from} to ${to}`);
}
