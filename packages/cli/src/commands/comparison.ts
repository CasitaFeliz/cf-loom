import {
  type Change,
  type ComparedReport,
  compatibilityReportOf,
  firstPublishChangesOf,
} from '@cf-loom/contract/internal';
import { publishedNameOf } from '../loading/index.ts';
import { type BuiltProject, builtOf, type Run } from '../project/index.ts';
import { baselineOf, type NoBaseline, type ReadBaseline } from '../registry/index.ts';
import type { Checked } from './checked.ts';
import { checkedChangeOf } from './checked-change.ts';
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
      readonly changes: readonly Change[];
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

/** Reads the package's Baseline, the highest version or the one `against` names, and runs the Compatibility Check of the Snapshot against it, or alone when it has none. */
export async function comparisonOf(
  built: BuiltProject,
  run: Run,
  against: string | undefined,
): Promise<Comparison | Stopped> {
  const { project, snapshot } = built;
  const npm = { directory: project.directory, env: run.env };
  const packageName = publishedNameOf(project.packageName, snapshot.kind);
  const read = await baselineOf(npm, { packageName, declared: snapshot, against });
  switch (read.kind) {
    case 'failed':
      return { kind: 'stopped', exit: toolingError(read.message) };
    case 'no-baseline': {
      const { packageName, why } = read;
      return {
        kind: 'no-baseline',
        built,
        packageName,
        why,
        changes: firstPublishChangesOf(snapshot),
      };
    }
    case 'baseline':
      return {
        kind: 'baseline',
        built,
        read,
        report: compatibilityReportOf(read.snapshot, snapshot),
      };
  }
}

/** What `check` reports of a comparison: the package, what it was compared with and every Change, before any version is derived from it. */
export function checkedFrom(comparison: Comparison): Checked {
  switch (comparison.kind) {
    case 'no-baseline': {
      const { packageName, why } = comparison;
      const changes = comparison.changes.map(checkedChangeOf);
      return {
        kind: 'checked',
        packageName,
        against: { kind: 'none', why },
        changes,
        derivation: null,
      };
    }
    case 'baseline': {
      const { packageName, snapshot, stable, chosen } = comparison.read;
      const against = { kind: 'baseline', version: snapshot.version, stable, chosen } as const;
      const changes = comparison.report.changes.map(checkedChangeOf);
      return { kind: 'checked', packageName, against, changes, derivation: null };
    }
  }
}
