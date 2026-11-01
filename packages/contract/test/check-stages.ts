import { expect } from 'vitest';
import type { ComparedReport } from '../src/internal/index.ts';
import { compatibilityReportOf, decodeSnapshot, originPackagesOf } from '../src/internal/index.ts';
import { inputOf } from './chain-fixtures.ts';
import { noChange, type StagesOf, stage } from './chain-stage.ts';

/**
 * A changed first link is a Neutral description change at each def that holds it, so at most one
 * Change for each def, however many times the def holds it.
 */
function neutralDescriptions(report: ComparedReport, count: number): void {
  const described = report.changes.filter(
    ({ class: changeClass, difference }) =>
      changeClass === 'neutral' &&
      difference.kind === 'schema' &&
      difference.shape.kind === 'annotation-changed',
  );
  expect(described).toHaveLength(report.changes.length);
  expect(report.changes.length).toBeGreaterThanOrEqual(1);
  expect(report.changes.length).toBeLessThanOrEqual(count);
}

/** What `check` reads a chain with: it decodes the Baseline, reads the origins and compares. */
export const checkStages = {
  decodeSnapshot: [
    stage(
      'check decodes the Baseline',
      (chain, count) => {
        const text = inputOf(chain, count, 'firstText');
        return () => decodeSnapshot(text);
      },
      (given) => expect(given.kind).toBe('decoded'),
    ),
    stage(
      'check decodes a Baseline holding a Former Input',
      (chain, count) => {
        const text = inputOf(chain, count, 'graftedText');
        return () => decodeSnapshot(text);
      },
      (given) => expect(given.kind).toBe('decoded'),
    ),
  ],
  originPackagesOf: [
    stage(
      'check reads the origins',
      (chain, count) => {
        const declared = inputOf(chain, count, 'declared');
        return () => originPackagesOf(declared);
      },
      (given) => expect(given).toEqual([]),
    ),
  ],
  compatibilityReportOf: [
    stage(
      'check compares an unchanged chain',
      (chain, count) => {
        const declared = inputOf(chain, count, 'declared');
        const same = inputOf(chain, count, 'same');
        return () => compatibilityReportOf(same, declared);
      },
      noChange,
    ),
    stage(
      'check compares a changed first link',
      (chain, count) => {
        const changed = inputOf(chain, count, 'changed');
        const same = inputOf(chain, count, 'same');
        return () => compatibilityReportOf(same, changed);
      },
      neutralDescriptions,
    ),
    stage(
      'check compares a removed field',
      (chain, count) => {
        const declared = inputOf(chain, count, 'declared');
        const baseline = inputOf(chain, count, 'baseline');
        return () => compatibilityReportOf(baseline, declared);
      },
      (given) => expect(given.changes).toHaveLength(1),
    ),
    stage(
      'check compares on a Baseline holding a Former Input',
      (chain, count) => {
        const declared = inputOf(chain, count, 'declared');
        const baseline = inputOf(chain, count, 'graftedBaseline');
        return () => compatibilityReportOf(baseline, declared);
      },
      noChange,
    ),
  ],
} as const satisfies StagesOf<'decodeSnapshot' | 'originPackagesOf' | 'compatibilityReportOf'>;
