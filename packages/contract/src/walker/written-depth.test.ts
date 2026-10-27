import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import type * as core from 'zod/v4/core';
import { refusalsOf } from '../../test/failures.ts';
import { seededNext } from '../../test/random-schemas.ts';
import { walkSchemas } from '../internal/index.ts';

const writtenTooDeep = { construct: 'a schema nested deeper than 256 schemas as written' };

/** The place of a schema walked in a declaration of its own: the export of the name given, with no steps. */
function placeIn(declaration: object, name = 'body') {
  return { site: { kind: 'export', name }, declaration, steps: [] } as const;
}

function walkBody(schema: core.$ZodType) {
  return refusalsOf(walkSchemas([{ at: placeIn({}), schema }], () => undefined));
}

/** `count` schemas, each wrapping the next by `wrap`, around `innermost`. */
function aNestOf(count: number, wrap: (inner: z.ZodType) => z.ZodType, innermost: z.ZodType) {
  let schema = innermost;
  for (let index = 0; index < count; index++) {
    schema = wrap(schema);
  }
  return schema;
}

/**
 * Each kind of schema zod enters on the way to the one it holds, with the step of the author's path
 * it adds, and the last step of each schema that sits at the 257th, in the order they are refused:
 * a record's key, a union's other option and an intersection's other item sit as deep as the next.
 */
const kinds = [
  ['.nullable()', (inner: z.ZodType) => inner.nullable(), '', ['']],
  ['z.lazy()', (inner: z.ZodType) => z.lazy(() => inner), '', ['']],
  ['z.array()', (inner: z.ZodType) => z.array(inner), '[]', ['[]']],
  ['an object’s field', (inner: z.ZodType) => z.object({ a: inner }), '.a', ['.a']],
  ['a record’s value', (inner: z.ZodType) => z.record(z.string(), inner), '{}', ['{key}', '{}']],
  ['a tuple’s item', (inner: z.ZodType) => z.tuple([inner]), '[0]', ['[0]']],
  [
    'a union’s option',
    (inner: z.ZodType) => z.union([inner, z.string()]),
    '<|0>',
    ['<|0>', '<|1>'],
  ],
  [
    'an intersection’s item',
    (inner: z.ZodType) => z.intersection(inner, z.object({})),
    '[0]',
    ['[0]', '[1]'],
  ],
] as const;

function casesOf(counts: readonly number[]) {
  return kinds.flatMap(([kind, wrap, step, lastSteps]) =>
    counts.map((count) => ({ kind, wrap, step, lastSteps, count })),
  );
}

describe('walkSchemas: how deep a schema nests as written', () => {
  test.for(casesOf([254, 255]))(
    '$count of $kind around z.number(), 256 schemas at most, walk',
    ({ wrap, count }) => {
      const schema = aNestOf(count, wrap, z.number());

      const walked = walkBody(schema).located[0];

      expect(walked?.kind).toBe('walked');
    },
  );

  test.for(casesOf([256, 257, 258]))(
    '$count of $kind around z.number() are refused at each schema that sits 257th',
    ({ wrap, step, lastSteps, count }) => {
      const schema = aNestOf(count, wrap, z.number());

      const walked = walkBody(schema).located[0];

      const failures = lastSteps.map((last) => ({
        kind: 'not-allowed',
        at: `${step.repeat(255)}${last}`.replace(/^\./, ''),
        ...writtenTooDeep,
      }));
      expect(walked).toEqual({ kind: 'not-allowed', failures });
    },
  );

  test.for([1, 2, 3])(
    'a random mix of the kinds, seed %i, is refused exactly when it holds more than 256 schemas',
    (seed) => {
      const next = seededNext(seed);
      const lengths = Array.from({ length: 20 }, () => 240 + Math.floor(next() * 40));

      const verdicts = lengths.map((length) => {
        let schema: z.ZodType = z.number();
        for (let index = 1; index < length; index++) {
          const [, wrap] = kinds[Math.floor(next() * kinds.length)] ?? kinds[0];
          schema = wrap(schema);
        }
        return walkBody(schema).located[0]?.kind;
      });

      expect(verdicts).toEqual(lengths.map((length) => (length > 256 ? 'not-allowed' : 'walked')));
    },
  );

  test.for([1, 2, 3])(
    'a def of random depth reached at a random depth, seed %i, is allowed in either order of its uses',
    (seed) => {
      const next = seededNext(seed);
      const draws = Array.from({ length: 10 }, () => ({
        own: 3 + Math.floor(next() * 254),
        reachedAt: 1 + Math.floor(next() * 256),
      }));

      const verdicts = draws.map(({ own, reachedAt }) => usesWalked(aDefOf(own), [reachedAt, 2]));

      expect(verdicts.flat()).toEqual(
        draws.flatMap(() => ['walked', 'walked', 'walked', 'walked']),
      );
    },
  );

  test('a def 200 schemas deep, reached 257, 200 and 2 deep in three declarations, is allowed in either order', () => {
    const def = aDefOf(200);

    const verdicts = usesWalked(def, [257, 200, 2]);

    expect(verdicts).toEqual(Array(6).fill('walked'));
  });
});

/** A recursive def whose deepest schema sits `own` schemas below it, itself the first. */
function aDefOf(own: number): z.ZodType {
  const def: z.ZodType = z
    .object({
      self: z.lazy(() => def).optional(),
      next: aNestOf(own - 2, (inner) => z.array(inner), z.number()),
    })
    .meta({ id: 'deep' });
  return def;
}

/**
 * How each use of a def walks, the use reached at each depth given being in a declaration of its
 * own: first in the order given, then in the reverse order.
 */
function usesWalked(def: z.ZodType, depths: readonly number[]) {
  const uses = depths.map((depth) => ({
    at: placeIn({}),
    schema: aNestOf(depth - 1, (inner) => z.array(inner), def),
  }));
  const inOrder = walkSchemas(uses, () => undefined).located;
  const reversed = walkSchemas([...uses].reverse(), () => undefined).located;
  return [...inOrder, ...reversed].map(({ walked }) => walked.kind);
}
