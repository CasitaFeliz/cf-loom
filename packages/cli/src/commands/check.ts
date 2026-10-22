import {
  type Change,
  type CompatibilityReport,
  compatibilityReportOf,
} from '@cf-loom/contract/internal';
import { builtOf, type Run } from '../project/index.ts';
import { baselineOf } from '../registry/index.ts';
import { checkedJsonOf, errorsExitOf } from './check-json.ts';
import { linesOf } from './check-lines.ts';
import { type Checked, endingOf } from './checked.ts';
import { committedStopOf, type Exit, failureExitOf, toolingError } from './exit.ts';

/** How a command prints: its lines, or, for `check`, one JSON document. */
export type Output = 'lines' | 'json';

/** Why `check` ended before it could compare. */
type Stopped = { readonly kind: 'stopped'; readonly exit: Exit };

/**
 * Runs the Compatibility Check of the committed Snapshot against its Baseline and prints every
 * Change with its class; it only reports, and the organization enforces any Approval.
 */
export async function check(run: Run, output: Output): Promise<Exit> {
  const checked = await checkedOf(run);
  switch (output) {
    case 'lines':
      return linesExitOf(checked);
    case 'json':
      return jsonExitOf(checked);
  }
}

function linesExitOf(checked: Checked | Stopped): Exit {
  if (checked.kind === 'stopped') {
    return checked.exit;
  }
  const { status, stderr } = endingOf(checked.changes);
  return { status, stdout: linesOf(checked, status), stderr };
}

function jsonExitOf(checked: Checked | Stopped): Exit {
  if (checked.kind === 'stopped') {
    return errorsExitOf(checked.exit);
  }
  const { status, stderr } = endingOf(checked.changes);
  return { status, stdout: [checkedJsonOf(checked, status)], stderr };
}

async function checkedOf(run: Run): Promise<Checked | Stopped> {
  const built = await builtOf(run, 'committed');
  if (built.kind !== 'built') {
    return { kind: 'stopped', exit: failureExitOf(built) };
  }
  const stop = committedStopOf(built);
  if (stop !== undefined) {
    return { kind: 'stopped', exit: stop };
  }
  const { project, snapshot } = built;
  const read = await baselineOf(
    { directory: project.directory, env: run.env },
    snapshot,
    project.scope,
  );
  switch (read.kind) {
    case 'failed':
      return { kind: 'stopped', exit: toolingError(read.message) };
    case 'no-baseline': {
      const { packageName, why } = read;
      return { kind: 'checked', packageName, against: { kind: 'none', why }, changes: [] };
    }
    case 'baseline': {
      const { packageName } = read;
      const against = { kind: 'baseline', version: read.snapshot.version } as const;
      const changes = changesOf(compatibilityReportOf(read.snapshot, snapshot));
      return { kind: 'checked', packageName, against, changes };
    }
  }
}

function changesOf(report: CompatibilityReport): readonly Change[] {
  switch (report.kind) {
    case 'compared':
      return report.changes;
    case 'no-baseline':
      throw new Error(
        'The Compatibility Check found no Baseline for a Baseline it was given: a bug.',
      );
  }
}
