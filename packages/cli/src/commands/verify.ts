import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  type BuiltProject,
  type BuiltService,
  builtOf,
  isBuiltService,
  type Run,
  snapshotFile,
} from '../project/index.ts';
import { type GeneratedFile, isUpToDate } from '../writing/index.ts';
import { checkFailed, done, type Exit, failureExitOf } from './exit.ts';
import { handlerPathsOf, noFileLinesOf, orphanLinesOf } from './handler-files.ts';
import { serviceFilesOf } from './regenerated.ts';

/**
 * Fails when a file `generate` regenerates is not what it would write, edited by hand or left
 * behind by a Contract change; which CLI wrote `contract.snapshot.json` does not count.
 */
export async function verify(run: Run): Promise<Exit> {
  const built = await builtOf(run, 'committed');
  if (built.kind !== 'built') {
    return failureExitOf(built);
  }
  const snapshotLine = snapshotFailureOf(built);
  const snapshotLines = snapshotLine === undefined ? [] : [snapshotLine];
  if (!isBuiltService(built)) {
    return verifiedExit(snapshotLines, [snapshotFile]);
  }
  const regenerated = serviceFilesOf(built);
  const failures = [...snapshotLines, ...serviceFailuresOf(run, built, regenerated)];
  return verifiedExit(failures, [snapshotFile, ...regenerated.map(({ path }) => path)]);
}

/** Every failure found, or each file compared up to date. */
function verifiedExit(failures: readonly string[], compared: readonly string[]): Exit {
  if (failures.length > 0) {
    return checkFailed(failures);
  }
  return done(compared.map((path) => `${path} is up to date`));
}

/**
 * What a Service fails `verify` on beside its Snapshot: its Handler map or readers out of date,
 * and its Handler files as `generate` would refuse or complete them. Exports are not loaded.
 */
function serviceFailuresOf(
  run: Run,
  service: BuiltService,
  regenerated: readonly GeneratedFile[],
): readonly string[] {
  const outdated = regenerated.filter((file) => !isUpToDate(run.cwd, file));
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
