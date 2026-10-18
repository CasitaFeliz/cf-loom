import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { builtOf, type Committed, snapshotFile } from './built.ts';
import { checkFailed, done, type Exit, type Run } from './exit.ts';
import {
  type BuiltProject,
  handlerFilesOf,
  orphanLinesOf,
  regeneratedFilesOf,
} from './generated-files.ts';
import { isUpToDate } from './writing.ts';

/**
 * Fails when a generated file is not what `generate` would write, edited by hand or left behind
 * by a Contract change, when a Handler the map imports is missing, or when a Handler file names
 * nothing declared; which CLI wrote `contract.snapshot.json` does not count.
 */
export async function verify(run: Run): Promise<Exit> {
  const built = await builtOf(run, 'committed');
  if (built.kind === 'stopped') {
    return built.exit;
  }
  const snapshotLine = snapshotFailureOf(built);
  const regenerated = regeneratedFilesOf(built).filter(({ path }) => path !== snapshotFile);
  const outdated = regenerated.filter((file) => !isUpToDate(run.cwd, file));
  const missing = handlerFilesOf(built).filter((path) => !existsSync(join(run.cwd, path)));
  const failures = [
    ...(snapshotLine === undefined ? [] : [snapshotLine]),
    ...outdated.map(({ path }) => `${path} was edited or is out of date: run cf-loom generate`),
    ...missing.map((path) => `${path} is missing: run cf-loom generate`),
    ...orphanLinesOf(built),
  ];
  if (failures.length > 0) {
    return checkFailed(failures);
  }
  const compared = [snapshotFile, ...regenerated.map(({ path }) => path)];
  return done(compared.map((path) => `${path} is up to date`));
}

function snapshotFailureOf(built: BuiltProject): string | undefined {
  const committed: Committed = built.committed;
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
