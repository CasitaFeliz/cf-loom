import {
  authorPathOf,
  type Change,
  type ChangeClass,
  type ChangeSite,
  type Difference,
  type Path,
  snapshotPathOf,
  type Verdict,
} from '@cf-loom/contract/internal';
import { hintOf } from './hints.ts';

type WithSnapshotPath<Each> = Each extends { readonly at: unknown }
  ? Omit<Each, 'at' | 'def'> & { readonly at: Path }
  : Each;

/**
 * A Difference as `check --json` prints it: every field of it and of its shape, `at` as the
 * Snapshot's path, from the recursive schema it is inside when there is one.
 */
export type DifferenceJson = WithSnapshotPath<Difference>;

/** A Change as `check` reports it: printed as JSON, and rendered as its line. */
export type CheckedChange = {
  readonly site: ChangeSite;
  readonly difference: DifferenceJson;
  readonly path: string | null;
  readonly class: ChangeClass;
  readonly verdict: Verdict;
  readonly hint: string | null;
};

/** The one structured Change the line and the JSON document both read. */
export function checkedChangeOf(change: Change): CheckedChange {
  const { site, difference, class: changeClass, verdict } = change;
  return {
    site,
    difference: differenceJsonOf(difference),
    path: pathOf(difference),
    class: changeClass,
    verdict,
    hint: hintOf(change),
  };
}

function pathOf(difference: Difference): string | null {
  if (!('at' in difference)) {
    return null;
  }
  return authorPathOf(difference.at, difference.kind === 'schema' ? difference.def : undefined);
}

function differenceJsonOf(difference: Difference): DifferenceJson {
  if (!('at' in difference)) {
    return difference;
  }
  if (difference.kind !== 'schema') {
    return { ...difference, at: snapshotPathOf(difference.at) };
  }
  const { def, ...placed } = difference;
  return { ...placed, at: snapshotPathOf(difference.at, def) };
}
