import {
  type ComparedReport,
  compatibilityReportOf,
  type Snapshot,
} from '@cf-loom/contract/internal';
import { type BuiltProject, builtOf, type Run } from '../project/index.ts';
import { baselineOf, type NoBaseline, type ReadBaseline } from '../registry/index.ts';
import type { Checked } from './checked.ts';
import { committedStopOf, failureExitOf, type Stopped, toolingError } from './exit.ts';

/** A package's Baseline as the registry holds it. */
type BaselineRead = Extract<ReadBaseline, { readonly kind: 'baseline' }>;

/** The committed Snapshot compared with the package's Baseline, or the reason it has none. */
export type Comparison =
  | {
      readonly kind: 'baseline';
      readonly built: BuiltProject;
      readonly read: BaselineRead;
      readonly report: ComparedReport;
    }
  | {
      readonly kind: 'no-baseline';
      readonly built: BuiltProject;
      readonly packageName: string;
      readonly why: NoBaseline;
    };

/**
 * Builds the project and requires its committed Snapshot to be what `generate` would write, so a
 * command that reads the registry acts on the file that was reviewed.
 */
export async function committedBuiltOf(run: Run): Promise<BuiltProject | Stopped> {
  const built = await builtOf(run, 'committed');
  if (built.kind !== 'built') {
    return { kind: 'stopped', exit: failureExitOf(built) };
  }
  const stop = committedStopOf(built);
  return stop === undefined ? built : { kind: 'stopped', exit: stop };
}

/** Reads the package's Baseline and runs the Compatibility Check of the Snapshot against it. */
export async function comparisonOf(built: BuiltProject, run: Run): Promise<Comparison | Stopped> {
  const { project, snapshot } = built;
  const npm = { directory: project.directory, env: run.env };
  const read = await baselineOf(npm, snapshot, project.scope);
  switch (read.kind) {
    case 'failed':
      return { kind: 'stopped', exit: toolingError(read.message) };
    case 'no-baseline': {
      const { packageName, why } = read;
      return { kind: 'no-baseline', built, packageName, why };
    }
    case 'baseline':
      return { kind: 'baseline', built, read, report: reportOf(read, snapshot) };
  }
}

/** What `check` reports of a comparison: the package, what it was compared with and every Change. */
export function checkedFrom(comparison: Comparison): Checked {
  switch (comparison.kind) {
    case 'no-baseline': {
      const { packageName, why } = comparison;
      return { kind: 'checked', packageName, against: { kind: 'none', why }, changes: [] };
    }
    case 'baseline': {
      const { packageName, snapshot } = comparison.read;
      const against = { kind: 'baseline', version: snapshot.version } as const;
      return { kind: 'checked', packageName, against, changes: comparison.report.changes };
    }
  }
}

function reportOf(read: BaselineRead, snapshot: Snapshot): ComparedReport {
  const report = compatibilityReportOf(read.snapshot, snapshot);
  if (report.kind === 'no-baseline') {
    throw new Error(
      'The Compatibility Check found no Baseline for a Baseline it was given: a bug.',
    );
  }
  return report;
}
