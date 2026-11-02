import { expect } from 'vitest';
import { canonicalTextOf, decodeSnapshot, publishedSnapshotOf } from '../src/internal/index.ts';
import { fannedInputOf, inputOf } from './chain-fixtures.ts';
import { publishedAt } from './snapshots.ts';
import { type StagesOf, stage } from './stage-type.ts';

/** The call `publish` writes the published Snapshot's text with. */
export const publishWritesText = stage(
  'publish writes the published text',
  (chain, count) => {
    const grafted = inputOf(chain, count, 'grafted');
    return () => canonicalTextOf(grafted);
  },
  (given) => expect(decodeSnapshot(given).kind).toBe('decoded'),
);

/** What `publish` merges a chain into: no Baseline, an unchanged one, one that held a field the chain lacks, one that held an object of a field for each link, each a `ref` to the top link, and one holding a Former Input. */
export const publishStages = {
  publishedSnapshotOf: [
    stage(
      'publish merges a first version',
      (chain, count) => {
        const declared = inputOf(chain, count, 'declared');
        return () => publishedSnapshotOf(undefined, declared, publishedAt('1.0.0'));
      },
      (given) => expect(given.formerInputs).toHaveLength(0),
    ),
    stage(
      'publish merges an unchanged chain',
      (chain, count) => {
        const declared = inputOf(chain, count, 'declared');
        const same = inputOf(chain, count, 'same');
        return () => publishedSnapshotOf(same, declared, publishedAt('1.2.0'));
      },
      (given) => expect(given.formerInputs).toHaveLength(0),
    ),
    stage(
      'publish grafts a removed field',
      (chain, count) => {
        const declared = inputOf(chain, count, 'declared');
        const baseline = inputOf(chain, count, 'baseline');
        return () => publishedSnapshotOf(baseline, declared, publishedAt('1.2.0'));
      },
      (given) => expect(given.formerInputs).toHaveLength(1),
    ),
    stage(
      'publish merges on a Baseline holding a Former Input',
      (chain, count) => {
        const declared = inputOf(chain, count, 'declared');
        const baseline = inputOf(chain, count, 'graftedBaseline');
        return () => publishedSnapshotOf(baseline, declared, publishedAt('1.2.0'));
      },
      (given) => expect(given.formerInputs).toHaveLength(1),
    ),
    stage(
      'publish grafts a removed field of refs',
      (chain, count) => {
        const { baseline, declared } = fannedInputOf(chain, count);
        return () => publishedSnapshotOf(baseline, declared, publishedAt('1.1.0'));
      },
      (given) => expect(given.formerInputs).toHaveLength(1),
    ),
  ],
} as const satisfies StagesOf<'publishedSnapshotOf'>;
