import type { PeerRanges } from '@cf-loom/contract/internal';
import type { Run } from '../project/index.ts';
import { type Comparison, committedBuiltOf, comparisonOf } from './comparison.ts';
import type { Stopped } from './exit.ts';
import { publishedRangesOf } from './peers.ts';

/** What `check` and `publish` go on with once the Snapshot is compared: the comparison and the peer ranges the package would be published with. */
export type Prepared = {
  readonly kind: 'prepared';
  readonly comparison: Comparison;
  readonly peerRanges: PeerRanges;
};

/**
 * Builds the project with its committed Snapshot, takes the peer ranges the package would be
 * published with, and compares the Snapshot with its Baseline, or with the version `against` names.
 */
export async function preparedOf(
  run: Run,
  against: string | undefined,
): Promise<Prepared | Stopped> {
  const built = await committedBuiltOf(run);
  if (built.kind === 'stopped') {
    return built;
  }
  const peerRanges = publishedRangesOf(built);
  const comparison = await comparisonOf(built, run, against);
  if (comparison.kind === 'stopped') {
    return comparison;
  }
  return { kind: 'prepared', comparison, peerRanges };
}
