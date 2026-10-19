import {
  type BuiltProject,
  type BuiltService,
  builtOf,
  isBuiltService,
  isCommittedCurrent,
  type Run,
  snapshotFile,
} from '../project/index.ts';
import { comparedOf } from '../writing/index.ts';
import { checkFailed, done, type Exit, failureExitOf, toolingError } from './exit.ts';
import { missingHandlerPathsOf, noFileLinesOf, orphanLinesOf } from './handler-files.ts';
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
  const compared = regenerated.map((file) => ({ file, compared: comparedOf(run.cwd, file) }));
  const unreadable = compared.find(({ compared: { kind } }) => kind === 'failed')?.compared;
  if (unreadable?.kind === 'failed') {
    return toolingError(unreadable.message);
  }
  const orphans = orphanLinesOf(built);
  if (orphans.kind === 'tooling') {
    return toolingError(orphans.message);
  }
  const outdated = compared.filter(({ compared: { kind } }) => kind === 'different');
  const failures = [
    ...snapshotLines,
    ...outdated.map(
      ({ file }) => `${file.path} was edited or is out of date: run cf-loom generate`,
    ),
    ...serviceFailuresOf(built),
    ...orphans.lines,
  ];
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
 * What a Service's Handler files fail `verify` on, as `generate` would complete or refuse them.
 * Exports are not loaded.
 */
function serviceFailuresOf(service: BuiltService): readonly string[] {
  return [
    ...missingHandlerPathsOf(service).map((path) => `${path} is missing: run cf-loom generate`),
    ...noFileLinesOf(service),
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
      return isCommittedCurrent(built)
        ? undefined
        : `${snapshotFile} was edited or is out of date: run cf-loom generate`;
  }
}
