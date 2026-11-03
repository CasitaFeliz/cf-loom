import { isDeepStrictEqual } from 'node:util';
import { describe, expect, test } from 'vitest';
import { publishedFirst } from '../../test/graft-fixtures.ts';
import {
  type DefGraftDraw,
  defGraftDrawOf,
  identityOf,
  reachesLanded,
  servicesOf,
  shuffledIdentities,
} from '../../test/random-def-grafts.ts';
import { seededNext } from '../../test/random-schemas.ts';
import { publishedAt } from '../../test/snapshots.ts';
import { compatibilityReportOf, type FormerInput, publishedSnapshotOf } from '../internal/index.ts';

describe('publishedSnapshotOf: former Inputs of Endpoints over seeded draws that remove fields only inside defs', () => {
  const draws = Array.from({ length: 3_000 }, (_, seed) => defGraftDrawOf(seed));
  const identitiesOf = ({ bodies }: DefGraftDraw) => bodies.map((_, index) => identityOf(index));

  /** The Former Inputs the draw's Service keeps when its Endpoints are published under the identities given. */
  function formerInputsUnder(draw: DefGraftDraw, identities: readonly string[]) {
    const { baseline, proposed } = servicesOf(draw, identities);
    return publishedSnapshotOf(publishedFirst(baseline), proposed, publishedAt('1.1.0'))
      .formerInputs;
  }

  /** For each Endpoint of the draw, whether its publish keeps a Former Input for it. */
  function keptOf(draw: DefGraftDraw): readonly boolean[] {
    const identities = identitiesOf(draw);
    const formers = formerInputsUnder(draw, identities);
    return identities.map((identity) => formers.some(({ endpoint }) => endpoint === identity));
  }

  const withoutEndpoint = (former: FormerInput | undefined) =>
    former === undefined ? undefined : { ...former, endpoint: '' };

  test('the draws hold removals that landed, edits that put no field back, and neither', () => {
    const landed = draws.filter(({ landed: owners }) => owners.length > 0);
    const steps = ['field', 'items', 'value', 'rest', 'variant'].map(
      (step) => landed.filter(({ kinds }) => kinds.has(`graft: ${step}`)).length,
    );
    const mixed = draws.filter((draw) => {
      const kept = keptOf(draw);
      return kept.includes(true) && kept.includes(false);
    });
    const counts = [
      draws.filter((draw) => draw.landed.length === 0 && draw.edited.length > 0).length,
      draws.filter((draw) => draw.landed.length === 0 && draw.edited.length === 0).length,
      landed.length,
      mixed.length,
    ];

    expect([counts, steps.map((count) => count >= 50)]).toEqual([
      [
        expect.toSatisfy((count: number) => count >= 100),
        expect.toSatisfy((count: number) => count >= 100),
        expect.toSatisfy((count: number) => count >= 1_000),
        expect.toSatisfy((count: number) => count >= 100),
      ],
      [true, true, true, true, true],
    ]);
  });

  test('a draw whose removals landed has an Endpoint that reaches one of them', () => {
    const unreached = draws.filter(
      (draw) => draw.landed.length > 0 && !draw.bodies.some((body) => reachesLanded(draw, body)),
    );

    expect(unreached.length).toBe(0);
  });

  test('the Compatibility Check accepts the Service of every draw', () => {
    const refused: number[] = [];
    for (const [seed, draw] of draws.entries()) {
      const { baseline, proposed } = servicesOf(draw, identitiesOf(draw));
      try {
        compatibilityReportOf(publishedFirst(baseline), proposed);
      } catch {
        refused.push(seed);
      }
    }

    expect(refused).toEqual([]);
  });

  test('an Endpoint keeps a Former Input exactly when its body reaches a def a removal landed in', () => {
    const wrong: string[] = [];
    for (const [seed, draw] of draws.entries()) {
      const kept = keptOf(draw);
      for (const [index, body] of draw.bodies.entries()) {
        if (kept[index] !== reachesLanded(draw, body)) {
          wrong.push(`${seed}: Endpoint ${index}`);
        }
      }
    }

    expect(wrong).toEqual([]);
  });

  test('the Former Inputs kept are the same whatever order the Endpoints’ identities put them in', () => {
    const different: string[] = [];
    for (const [seed, draw] of draws.entries()) {
      const identities = identitiesOf(draw);
      const permuted = shuffledIdentities(identities, seededNext(seed + 7));
      const was = formerInputsUnder(draw, identities);
      const now = formerInputsUnder(draw, permuted);
      for (const [index, identity] of identities.entries()) {
        const before = withoutEndpoint(was.find(({ endpoint }) => endpoint === identity));
        const after = withoutEndpoint(now.find(({ endpoint }) => endpoint === permuted[index]));
        if (!isDeepStrictEqual(before, after)) {
          different.push(`${seed}: Endpoint ${index}`);
        }
      }
    }

    expect(different).toEqual([]);
  });
});
