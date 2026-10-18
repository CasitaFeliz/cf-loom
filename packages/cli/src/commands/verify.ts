import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  type BuiltProject,
  type BuiltService,
  builtOf,
  isBuiltService,
  snapshotFile,
} from './built.ts';
import { checkFailed, done, type Exit, type Run } from './exit.ts';
import { handlerPathsOf, noFileLinesOf, orphanLinesOf, serviceFilesOf } from './handler-files.ts';
import { isUpToDate } from './writing.ts';

/**
 * Fails when a file `generate` regenerates is not what it would write, edited by hand or left
 * behind by a Contract change; which CLI wrote `contract.snapshot.json` does not count.
 */
export async function verify(run: Run): Promise<Exit> {
  const built = await builtOf(run, 'committed');
  if (built.kind === 'stopped') {
    return built.exit;
  }
  const service = isBuiltService(built) ? built : undefined;
  const snapshotLine = snapshotFailureOf(built);
  const serviceLines = service === undefined ? [] : serviceFailuresOf(run, service);
  const failures = [...(snapshotLine === undefined ? [] : [snapshotLine]), ...serviceLines];
  if (failures.length > 0) {
    return checkFailed(failures);
  }
  const compared = service === undefined ? [] : serviceFilesOf(service).map(({ path }) => path);
  return done([snapshotFile, ...compared].map((path) => `${path} is up to date`));
}

/**
 * What a Service fails `verify` on beside its Snapshot: its Handler map or readers out of date,
 * and its Handler files as `generate` would refuse or complete them. Exports are not loaded.
 */
function serviceFailuresOf(run: Run, service: BuiltService): readonly string[] {
  const outdated = serviceFilesOf(service).filter((file) => !isUpToDate(run.cwd, file));
  const missing = handlerPathsOf(service).filter((path) => !existsSync(join(run.cwd, path)));
  return [
    ...outdated.map(({ path }) => `${path} was edited or is out of date: run cf-loom generate`),
    ...missing.map((path) => `${path} is missing: run cf-loom generate`),
    ...noFileLinesOf(service),
    ...orphanLinesOf(service),
  ];
}

function snapshotFailureOf(built: BuiltProject): string | undefined {
  const { committed } = built;
  switch (committed.kind) {
    case 'none':
      return `${snapshotFile} is missing: run cf-loom generate`;
    case 'no-json':
      return `${snapshotFile} was edited: it is no JSON (${committed.reason})`;
    case 'json':
      return built.bytes.equals(committed.bytes)
        ? undefined
        : `${snapshotFile} was edited or is out of date: run cf-loom generate`;
  }
}
