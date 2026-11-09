import { expect } from 'vitest';
import { defGraphOf, type RefNode } from '../src/internal/index.ts';
import { inputOf } from './chain-fixtures.ts';
import { type StagesOf, stage } from './stage-type.ts';

const firstLinkFact = 'holds the first link';

/** A `ref` to each link of a chain of `count`, from the top down. */
function refsToLinksOf(count: number): readonly RefNode[] {
  return Array.from({ length: count }, (_, index) => ({
    type: 'ref',
    name: `link${count - 1 - index}`,
  }));
}

/**
 * What every command asks of the Def graph of a chain's defs: the defs the top link reaches, the def
 * a `ref` to each link stands for, and the closure facts of a fact the first link holds. Each call
 * builds its graph, on a copy of the defs of its own, so no memo answers for the build.
 */
export const defGraphStages = {
  defGraphOf: [
    stage(
      'the Def graph reaches every link',
      (chain, count) => {
        const { defs } = inputOf(chain, count, 'grafted');
        const top = defs[`link${count - 1}`] ?? { type: 'string' };
        return () => defGraphOf(defs).reached([top]);
      },
      (given, count) => {
        expect(Object.keys(given.held)).toHaveLength(count);
        expect(given.unheld).toEqual([]);
      },
    ),
    stage(
      'the Def graph resolves a ref to every link',
      (chain, count) => {
        const { defs } = inputOf(chain, count, 'grafted');
        const refs = refsToLinksOf(count);
        return () => {
          const graph = defGraphOf(defs);
          return refs.map((ref) => graph.resolved(ref));
        };
      },
      (given, count) => {
        expect(given).toHaveLength(count);
        expect(given.filter((resolved) => resolved === undefined)).toEqual([]);
        expect(given.filter((resolved) => resolved?.def.type === 'ref')).toEqual([]);
      },
    ),
    stage(
      'the Def graph carries a fact from the first link to every link',
      (chain, count) => {
        const { defs } = inputOf(chain, count, 'grafted');
        return () =>
          defGraphOf(defs).closureFacts((name) => (name === 'link0' ? [firstLinkFact] : []));
      },
      (given, count) => {
        expect(given.size).toBe(count);
        expect([...given.values()].filter((facts) => !facts.has(firstLinkFact))).toEqual([]);
      },
    ),
  ],
} as const satisfies StagesOf<'defGraphOf'>;
