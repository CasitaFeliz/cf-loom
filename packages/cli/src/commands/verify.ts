import { contractExportsOf } from '../loading/index.ts';
import {
  type BuiltProject,
  builtOf,
  isBuiltService,
  isCommittedCurrent,
  type Run,
  snapshotFile,
} from '../project/index.ts';
import type { HandlerPath } from '../service-code/index.ts';
import { comparedOf } from '../writing/index.ts';
import { checkFailed, done, type Exit, failureExitOf, toolingError } from './exit.ts';
import { noFileLinesOf, type PlacedService, placedOf } from './handler-files.ts';
import { orphansOf } from './orphans.ts';
import { pendingLineOf } from './placement.ts';
import { serviceFilesOf } from './regenerated.ts';
import { stubsOf } from './stubs.ts';
import { unreachedLinesOf } from './unreached.ts';

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
  const service = placedOf(built);
  if (service.kind === 'tooling') {
    return toolingError(service.message);
  }
  return await verifyService(run, service, snapshotLines);
}

/**
 * A Service's regenerated files compared with what `generate` would write, the Elements it could
 * not import as they are named, and its Handler files.
 */
async function verifyService(
  run: Run,
  service: PlacedService,
  snapshotLines: readonly string[],
): Promise<Exit> {
  const exports = await contractExportsOf(service.project.directory);
  if (exports.kind === 'failed') {
    return toolingError(exports.message);
  }
  const regenerated = serviceFilesOf(service, exports.exportsOf);
  if (regenerated.kind === 'unnamed') {
    return toolingError(regenerated.line);
  }
  const compared = regenerated.files.map((file) => ({ file, compared: comparedOf(run.cwd, file) }));
  const unreadable = compared.find(({ compared: { kind } }) => kind === 'failed')?.compared;
  if (unreadable?.kind === 'failed') {
    return toolingError(unreadable.message);
  }
  const orphans = orphansOf(service);
  if (orphans.kind === 'tooling') {
    return toolingError(orphans.message);
  }
  const outdated = compared.filter(({ compared: { kind } }) => kind === 'different');
  const failures = [
    ...snapshotLines,
    ...outdated.map(
      ({ file }) => `${file.path} was edited or is out of date: run cf-loom generate`,
    ),
    ...stubsOf(service, exports.exportsOf, orphans.lacking).failureLines,
    ...regenerated.failureLines,
    ...unreachedLinesOf(service, exports.exports),
    ...serviceFailuresOf(service, orphans.lacking),
    ...orphans.lines,
    ...orphans.moves.map(pendingLineOf),
  ];
  return verifiedExit(failures, [snapshotFile, ...regenerated.files.map(({ path }) => path)]);
}

/** Every failure found, or each file compared up to date. */
function verifiedExit(failures: readonly string[], compared: readonly string[]): Exit {
  if (failures.length > 0) {
    return checkFailed(failures);
  }
  return done(compared.map((path) => `${path} is up to date`));
}

/** What a Service's Handler files fail `verify` on, as `generate` would complete or refuse them. */
function serviceFailuresOf(
  service: PlacedService,
  lacking: readonly HandlerPath[],
): readonly string[] {
  return [
    ...lacking.map(({ path }) => `${path} is missing: run cf-loom generate`),
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
