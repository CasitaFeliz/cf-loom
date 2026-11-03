import type { Defs, ObjectNode, SchemaNode, ServiceSnapshot } from '../src/internal/index.ts';
import { namesReachedBy } from './graft-defs.ts';
import { aVersionOf, graftedIdentity } from './graft-fixtures.ts';
import { isRef, nodesIn } from './random-draft.ts';
import { type GraftDraw, graftDrawOf } from './random-grafts.ts';
import { seededNext } from './random-schemas.ts';

/** The Input body of the one Endpoint a draw's version declares. */
function bodyOf(version: ServiceSnapshot): ObjectNode {
  const body = version.endpoints[graftedIdentity]?.input.body;
  if (body?.type !== 'object') {
    throw new Error('A draw without an object body: a bug of the test.');
  }
  return body;
}

/**
 * A `graftDrawOf` draw whose Baseline holds one def its Input reaches twice: the def and a twin of
 * it under another name, each Baseline `ref` to the def pointing at the twin or not as a coin
 * says, so two Baseline defs pair with the proposed def of the one name; the proposed version is
 * the draw's own, which holds no twin.
 */
export function doubledGraftDrawOf(seed: number): GraftDraw {
  const draw = graftDrawOf(seed);
  const next = seededNext(seed * 4093 + 29);
  const body = bodyOf(draw.baseline);
  const defs = draw.baseline.defs;
  const doubled = [...namesReachedBy([body], defs)].filter((name) => defs[name]?.type !== 'ref');
  const original = doubled[Math.floor(next() * doubled.length)];
  if (original === undefined) {
    return draw;
  }
  const twin = `${original}Twin`;
  const held: { body: ObjectNode; defs: Defs } = structuredClone({
    body,
    defs: { ...defs, [twin]: defs[original] as SchemaNode },
  });
  const refs = nodesIn([held.body, ...Object.values(held.defs)]).filter(isRef);
  for (const ref of refs.filter(({ name }) => name === original)) {
    if (next() < 0.5) {
      ref.name = twin;
    }
  }
  return {
    ...draw,
    baseline: aVersionOf(held.body, held.defs),
    kinds: new Set([...draw.kinds, `twin: ${original}`]),
  };
}
