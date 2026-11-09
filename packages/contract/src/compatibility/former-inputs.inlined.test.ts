import { describe, expect, test } from 'vitest';
import {
  apartGroupsOf,
  fieldsOfDef,
  holdsObjectOf,
  problemsOfPublished,
  publishedThrough,
} from '../../test/graft-pools.ts';
import { inlinedGraftDrawOf } from '../../test/random-inlined-grafts.ts';

describe('publishedSnapshotOf: former Inputs over seeded draws whose proposed version writes a def inline', () => {
  const draws = Array.from({ length: 3_000 }, (_, seed) => inlinedGraftDrawOf(seed));

  /** Whether a Former Input holds, in two defs named apart from one proposed def, the object the proposed version writes in place. */
  function holdsWrittenTwice(draw: (typeof draws)[number]): boolean {
    const name = [...draw.kinds].find((kind) => kind.startsWith('inlined: '))?.slice(9);
    const fieldNames = Object.keys(fieldsOfDef(draw.baseline.defs[name ?? '']));
    return publishedThrough(draw.baseline, draw.proposed).formerInputs.some((former) =>
      apartGroupsOf(former).some(
        (group) => group.filter((def) => holdsObjectOf(former.defs[def], fieldNames)).length >= 2,
      ),
    );
  }

  test('the draws hold a pair written inline on the proposed side reached twice, and grafted under both', () => {
    const inlined = draws.filter(({ kinds }) =>
      [...kinds].some((kind) => kind.startsWith('inlined: ')),
    );
    const twice = draws.filter(holdsWrittenTwice);
    const grafted = twice.filter(({ kinds }) => kinds.has('inlined: lost a field'));

    expect([inlined.length, twice.length, grafted.length]).toEqual([
      expect.toSatisfy((count: number) => count >= 500),
      expect.toSatisfy((count: number) => count >= 100),
      expect.toSatisfy((count: number) => count >= 50),
    ]);
  });

  test('a kept former Input of a draw whose proposed version writes a def inline is the Input as it was, and decodes', () => {
    const problems = draws.flatMap((draw, seed) =>
      problemsOfPublished(draw, publishedThrough(draw.baseline, draw.proposed)).map(
        (problem) => `${seed}: ${problem}`,
      ),
    );

    expect(problems).toEqual([]);
  });
});
