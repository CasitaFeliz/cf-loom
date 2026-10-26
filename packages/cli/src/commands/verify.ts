import { contractExportsOf } from '../loading/index.ts';
import {
  type BuiltProject,
  builtOf,
  committedComparisonOf,
  isBuiltService,
  type Run,
  snapshotFile,
} from '../project/index.ts';
import type { HandlerPath } from '../service-code/index.ts';
import { type Compared, comparedOf, type GeneratedFile } from '../writing/index.ts';
import { checkFailed, crlfLineOf, done, type Exit, failureExitOf, toolingError } from './exit.ts';
import { noFileLinesOf, type PlacedService, placedOf } from './handler-files.ts';
import { pendingLineOf } from './placement.ts';
import { type RecordRead, recordOf } from './record.ts';
import { serviceFilesOf } from './regenerated.ts';
import { stubsOf } from './stubs.ts';
import { unreachedLinesOf } from './unreached.ts';

/**
 * Fails when a file `generate` regenerates is not what it would write, edited by hand or left
 * behind by a Contract change.
 */
export async function verify(run: Run): Promise<Exit> {
  const built = await builtOf(run);
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
  const compared = regenerated.files.map((file) => ({ file, compared: comparedOf(run.cwd, file) }));
  const unreadable = compared.find(({ compared: { kind } }) => kind === 'failed')?.compared;
  if (unreadable?.kind === 'failed') {
    return toolingError(unreadable.message);
  }
  const record = recordOf(service);
  if (record.kind === 'tooling') {
    return toolingError(record.message);
  }
  const failures = [
    ...snapshotLines,
    ...comparedFailuresOf(compared),
    ...stubsOf(service, exports.exportsOf, record.lacking).failureLines,
    ...regenerated.failureLines,
    ...unreachedLinesOf(service, exports.exports),
    ...serviceFailuresOf(service, record.lacking),
    ...recordFailuresOf(record),
  ];
  return verifiedExit(failures, [snapshotFile, ...regenerated.files.map(({ path }) => path)]);
}

/** The lines for the regenerated files that differ from what `generate` would write, or only by their line endings. */
function comparedFailuresOf(
  compared: readonly { readonly file: GeneratedFile; readonly compared: Compared }[],
): readonly string[] {
  return compared.flatMap(({ file, compared: result }) => comparedFailureLinesOf(file, result));
}

function comparedFailureLinesOf(file: GeneratedFile, compared: Compared): readonly string[] {
  switch (compared.kind) {
    case 'same':
    case 'failed':
      return [];
    case 'different':
      return [`${file.path} was edited or is out of date: run cf-loom generate`];
    case 'crlf':
      return [crlfLineOf(file.path)];
  }
}

/** What the record leaves for `generate` to do or for the author to settle, as `verify` says it. */
function recordFailuresOf(
  record: Extract<RecordRead, { readonly kind: 'read' }>,
): readonly string[] {
  const rule = 'is a file cf-loom generate wrote, at no path the layout names';
  return [
    ...record.lines,
    ...record.moves.map(pendingLineOf),
    ...record.stale.map((path) => `${path} ${rule}: run cf-loom generate`),
  ];
}

/** Every failure found, or each file compared up to date. */
function verifiedExit(failures: readonly string[], compared: readonly string[]): Exit {
  if (failures.length > 0) {
    return checkFailed(failures);
  }
  return done(
    compared.map((path) => `${path} is up to date`),
    { upToDate: compared },
  );
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
      return jsonFailureOf(built);
  }
}

function jsonFailureOf(built: BuiltProject): string | undefined {
  switch (committedComparisonOf(built)) {
    case 'same':
      return undefined;
    case 'crlf':
      return crlfLineOf(snapshotFile);
    case 'different':
      return `${snapshotFile} was edited or is out of date: run cf-loom generate`;
  }
}
