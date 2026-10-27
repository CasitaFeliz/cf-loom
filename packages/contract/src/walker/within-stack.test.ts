import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { summarized } from '../../test/failures.ts';
import { seededNext } from '../../test/random-schemas.ts';
import { aRootPackage } from '../../test/root-package.ts';
import {
  type Attachment,
  defineEndpoint,
  defineGroup,
  defineGuard,
  defineService,
} from '../index.ts';
import { type Root, validateRoot } from '../internal/index.ts';

const exampleRefused = 'an example the schema refuses (examples[0])';

/** A value of `levels` trees, each the only kid of the one around it. */
function aTreeOf(levels: number): unknown {
  let tree: unknown = { kids: [] };
  for (let level = 0; level < levels; level++) {
    tree = { kids: [tree] };
  }
  return tree;
}

/**
 * A recursive def whose kids are each `wrappers` of `.nullable()` around the def itself, so zod
 * enters that many schemas more for each level of a value, with the examples given.
 */
function aTreeSchema(wrappers: number, examples?: readonly unknown[]): z.ZodType {
  const tree: z.ZodType = z
    .object({
      kids: z.array(
        nullableIn(
          wrappers,
          z.lazy(() => tree),
        ),
      ),
    })
    .meta({ id: 'tree', ...(examples && { examples: [...examples] }) });
  return tree;
}

function nullableIn(wrappers: number, inner: z.ZodType): z.ZodType {
  let schema = inner;
  for (let index = 0; index < wrappers; index++) {
    schema = schema.nullable();
  }
  return schema;
}

function validate(root: Root) {
  return summarized(validateRoot(root, aRootPackage(root)));
}

function aServiceListing(body: z.ZodType, guards: readonly Attachment[] = []) {
  const endpoint = defineEndpoint({
    name: 'listTrees',
    method: 'GET',
    path: '/trees',
    visibility: 'public',
    description: 'Every tree',
    success: { status: 200, body },
    guards,
  });
  const trees = defineGroup({ name: 'trees', description: 'Trees', endpoints: [endpoint] });
  return defineService({ name: 'trees-service', groups: [trees] });
}

/** Seeded draws of how many wrappers each level holds, up to 250, and how many levels a value nests, up to 120. */
function drawsOf(seed: number) {
  const next = seededNext(seed);
  const draws = Array.from({ length: 6 }, () => ({
    wrappers: Math.floor(next() * 251),
    levels: Math.floor(next() * 121),
  }));
  return [...draws, { wrappers: 250, levels: 120 }];
}

describe('validateRoot: zod parses within the call stack', () => {
  test.for([1, 2, 3])(
    'an example of a deep tree, seed %i, validates or is refused by the example line, never a throw',
    (seed) => {
      const verdicts = drawsOf(seed).map(({ wrappers, levels }) =>
        validate(aServiceListing(aTreeSchema(wrappers, [aTreeOf(levels)]))),
      );

      for (const verdict of verdicts) {
        const constructs = verdict.kind === 'valid' ? [] : verdict.failures.map(constructOf);
        expect(constructs.every((construct) => construct === exampleRefused)).toBe(true);
      }
      expect(verdicts.some(({ kind }) => kind === 'invalid')).toBe(true);
    },
  );

  test.for([1, 2, 3])(
    'a Qualifier of a deep tree, seed %i, validates or fails qualifier-value, never a throw',
    (seed) => {
      const verdicts = drawsOf(seed).map(({ wrappers, levels }) => {
        const forest = defineGuard({
          name: 'forest',
          description: 'A forest',
          qualifier: aTreeSchema(wrappers),
        });
        const body = z.object({ id: z.string() });
        return validate(aServiceListing(body, [{ guard: forest, qualifier: aTreeOf(levels) }]));
      });

      for (const verdict of verdicts) {
        const rules = verdict.kind === 'valid' ? [] : verdict.failures.map(ruleOf);
        expect(rules.every((rule) => rule === 'qualifier-value')).toBe(true);
      }
      expect(verdicts.some(({ kind }) => kind === 'invalid')).toBe(true);
    },
  );
});

function constructOf(failure: { readonly kind: string; readonly construct?: string }) {
  return failure.construct;
}

function ruleOf(failure: { readonly kind: string; readonly rule?: string }) {
  return failure.rule;
}
