import {
  type Change,
  type ComparedReport,
  compatibilityReportOf,
  firstPublishChangesOf,
} from '@cf-loom/contract/internal';
import { publishedNameOf } from '../loading/index.ts';
import { type BuiltProject, builtOf } from '../project/index.ts';
import { type Baseline, baselineOf, type Listing, type NoBaseline } from '../registry/index.ts';
import { listedVersionsOf } from '../versioning/index.ts';
import { type Compared, reasonOf } from './checked.ts';
import { checkedChangeOf } from './checked-change.ts';
import { committedStopOf, failureExitOf, type Stopped, toolingError } from './exit.ts';
import type { Run } from './run.ts';

/** The committed Snapshot compared with the package's Baseline, or alone when it has none, and what the registry lists for the package. */
export type Comparison = {
  readonly kind: 'comparison';
  readonly built: BuiltProject;
  readonly listing: Listing;
  readonly compared:
    | {
        readonly kind: 'baseline';
        readonly baseline: Baseline;
        readonly report: ComparedReport;
      }
    | {
        readonly kind: 'no-baseline';
        readonly why: NoBaseline;
        readonly changes: readonly Change[];
      };
};

/**
 * Builds the project and requires its committed Snapshot to be what `generate` would write, so a
 * command that reads the registry acts on the file that was reviewed.
 */
export async function committedBuiltOf(run: Run): Promise<BuiltProject | Stopped> {
  const built = await builtOf(run.cwd);
  if (built.kind !== 'built') {
    return { kind: 'stopped', exit: failureExitOf(built) };
  }
  const stop = committedStopOf(built);
  return stop === undefined ? built : { kind: 'stopped', exit: stop };
}

/** Reads the package's Baseline, or the version `against` names, and runs the Compatibility Check of the Snapshot against it, or alone when it has none. */
export async function comparisonOf(
  built: BuiltProject,
  run: Run,
  against: string | undefined,
): Promise<Comparison | Stopped> {
  const { project, snapshot } = built;
  const npm = { directory: project.directory, env: run.env };
  const packageName = publishedNameOf(project.packageName, snapshot.kind);
  const read = await baselineOf(npm, { packageName, declared: snapshot, against });
  if (read.kind === 'failed') {
    return { kind: 'stopped', exit: toolingError(read.message) };
  }
  const { listing, baseline } = read;
  switch (baseline.kind) {
    case 'baseline': {
      const report = compatibilityReportOf(baseline.snapshot, snapshot);
      return {
        kind: 'comparison',
        built,
        listing,
        compared: { kind: 'baseline', baseline, report },
      };
    }
    case 'unknown-package':
    case 'none-published': {
      const changes = firstPublishChangesOf(snapshot);
      const compared = { kind: 'no-baseline', why: baseline, changes } as const;
      return { kind: 'comparison', built, listing, compared };
    }
  }
}

/** What `check` reports of a comparison: the package, what it was compared with and every Change, before any version is derived from it. */
export function comparedFrom({ listing, compared }: Comparison): Compared {
  const { packageName } = listing;
  const { stable } = listedVersionsOf(listing.versions);
  switch (compared.kind) {
    case 'no-baseline': {
      const against = { kind: 'none', reason: reasonOf(compared.why, listing) } as const;
      const changes = compared.changes.map(checkedChangeOf);
      return { kind: 'checked', packageName, stable, against, changes };
    }
    case 'baseline': {
      const { snapshot, chosen } = compared.baseline;
      const against = { kind: 'baseline', version: snapshot.version, chosen } as const;
      const changes = compared.report.changes.map(checkedChangeOf);
      return { kind: 'checked', packageName, stable, against, changes };
    }
  }
}
