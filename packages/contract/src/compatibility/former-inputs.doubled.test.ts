import { describe, expect, test } from 'vitest';
import {
  apartGroupsOf,
  hasTwoApartNamingOne,
  problemsOfPublished,
  publishedThrough,
} from '../../test/graft-pools.ts';
import { doubledGraftDrawOf } from '../../test/random-doubled-grafts.ts';

describe('publishedSnapshotOf: former Inputs over seeded draws whose Baseline holds a def twice', () => {
  const draws = Array.from({ length: 3_000 }, (_, seed) => doubledGraftDrawOf(seed));

  test('the draws hold Former Inputs with two defs named apart from one proposed def, and both naming one def named apart', () => {
    const counts = { apart: 0, naming: 0 };
    for (const draw of draws) {
      const { formerInputs } = publishedThrough(draw.baseline, draw.proposed);
      counts.apart += formerInputs.some((former) => apartGroupsOf(former).length > 0) ? 1 : 0;
      counts.naming += formerInputs.some(hasTwoApartNamingOne) ? 1 : 0;
    }

    expect([counts.apart, counts.naming]).toEqual([
      expect.toSatisfy((count: number) => count >= 100),
      expect.toSatisfy((count: number) => count >= 50),
    ]);
  });

  test('a kept former Input of a draw whose Baseline holds a def twice is the Input as it was, and decodes', () => {
    const problems = draws.flatMap((draw, seed) =>
      problemsOfPublished(draw, publishedThrough(draw.baseline, draw.proposed)).map(
        (problem) => `${seed}: ${problem}`,
      ),
    );

    expect(problems).toEqual([]);
  });
});
