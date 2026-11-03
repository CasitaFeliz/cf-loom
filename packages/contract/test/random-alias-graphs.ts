import type {
  Defs,
  Field,
  ObjectNode,
  RefNode,
  SchemaNode,
  ServiceSnapshot,
} from '../src/internal/index.ts';
import { anEndpointOf, anObject, aRef, aServiceOf, aString } from './graft-fixtures.ts';
import type { Next } from './random-draft.ts';
import { seededNext } from './random-schemas.ts';

/** The identity of the one Endpoint of a draw. */
const identity = 'PUT /e';

/**
 * Two versions of a Service whose defs are an object `o` and 2 to 6 alias defs, each naming `o` or
 * an alias def after it, so chains of alias defs join part way; each side draws its own chains and
 * descriptions. The Endpoint's body has 3 to 8 fields, each a `ref` to a point of the chain on
 * each side, the same point or another, or, on the proposed side only, `o` written in place.
 */
export type AliasGraphDraw = {
  readonly baseline: ServiceSnapshot;
  readonly proposed: ServiceSnapshot;
};

function pointOf(points: readonly string[], next: Next): string {
  return points[Math.floor(next() * points.length)] as string;
}

/** The alias defs of one side, `a0`… `a<count - 1>`, each naming `o` or an alias def after it, described or not. */
function aliasDefsOf(count: number, next: Next): Defs {
  const described = ['x', 'y', undefined];
  const aliases = Array.from({ length: count }, (_, index): [string, SchemaNode] => {
    const later = Array.from(
      { length: count - index - 1 },
      (_, offset) => `a${index + 1 + offset}`,
    );
    const description = described[Math.floor(next() * described.length)];
    const alias = aRef(pointOf(['o', ...later], next)) as RefNode;
    return [`a${index}`, description === undefined ? alias : { ...alias, description }];
  });
  return Object.fromEntries(aliases);
}

/** A `ref` to a point, nullable now and then. */
function useOf(name: string, next: Next): SchemaNode {
  return next() < 0.15 ? { type: 'ref', name, nullable: true } : aRef(name);
}

/** The object `o`, with a field of its own besides the first two now and then. */
function objectOf(fieldNames: readonly string[]): ObjectNode {
  const fields = fieldNames.map((name): [string, Field] => [
    name,
    { required: true, schema: aString },
  ]);
  return anObject(Object.fromEntries(fields));
}

/** The fields of `o` in the proposed version: one lost, one gained, or the same. */
function proposedFieldsOf(names: readonly string[], next: Next): readonly string[] {
  const roll = next();
  if (roll < 0.3) {
    return names.slice(0, -1);
  }
  return roll < 0.5 ? [...names, 'q'] : names;
}

/** The pair of versions a seed draws, the same every run. */
export function aliasGraphDrawOf(seed: number): AliasGraphDraw {
  const next = seededNext(seed * 4423 + 7);
  const count = 2 + Math.floor(next() * 5);
  const names = ['p0', 'p1', 'p2', 'p3'].slice(0, 2 + Math.floor(next() * 3));
  const proposedNames = proposedFieldsOf(names, next);
  const points = ['o', ...Array.from({ length: count }, (_, index) => `a${index}`)];
  const fieldCount = 3 + Math.floor(next() * 6);
  const uses = Array.from({ length: fieldCount }, (_, index) => {
    const baseline = pointOf(points, next);
    const roll = next();
    const proposed = roll < 0.55 ? baseline : pointOf(points, next);
    return { name: `f${index}`, baseline, proposed, isWritten: roll > 0.8 };
  });
  const baselineDefs: Defs = { o: objectOf(names), ...aliasDefsOf(count, next) };
  const proposedDefs: Defs = { o: objectOf(proposedNames), ...aliasDefsOf(count, next) };
  const bodyOf = (side: 'baseline' | 'proposed') =>
    anObject(
      Object.fromEntries(
        uses.map((use): [string, Field] => {
          const written = side === 'proposed' && use.isWritten;
          const schema = written ? objectOf(proposedNames) : useOf(use[side], next);
          return [use.name, { required: true, schema }];
        }),
      ),
    );
  const serviceOf = (side: 'baseline' | 'proposed', defs: Defs) =>
    aServiceOf({ [identity]: anEndpointOf(bodyOf(side)) }, defs);
  return {
    baseline: serviceOf('baseline', baselineDefs),
    proposed: serviceOf('proposed', proposedDefs),
  };
}
