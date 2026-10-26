import type { Lifecycle } from '../declarations/index.ts';
import type { SchemaNode } from '../walker/index.ts';
import { partsOf } from '../walker/index.ts';
import type { BothDefs } from './findings.ts';
import { comparedShapesOf, type Pair } from './pairs.ts';
import type { Difference } from './report.ts';
import { type EndpointPlace, schemaDifferencesOf } from './schemas.ts';

/** A body of the Baseline and the proposed one, `null` where none is declared. */
export type Bodies = {
  readonly baseline: SchemaNode | null;
  readonly proposed: SchemaNode | null;
};

/**
 * A body declared on one side only is added or removed; one on both sides is compared by its
 * schema in its Position. An undeclared body is never read, so a Caller sends or reads none.
 */
export function bodyDifferencesOf(
  { baseline, proposed }: Bodies,
  defs: BothDefs,
  place: EndpointPlace,
): readonly Difference[] {
  if (baseline === null && proposed === null) {
    return [];
  }
  if (baseline === null) {
    return [{ kind: 'body-added', at: place.at, position: place.position }];
  }
  if (proposed === null) {
    return [{ kind: 'body-removed', at: place.at, position: place.position }];
  }
  return schemaDifferencesOf({ baseline, proposed }, defs, place);
}

/** A Message Version's body Differences, read as Message, unless it is Retired now. */
export function messageBodyDifferencesOf(
  pair: Pair<{ readonly body: SchemaNode; readonly lifecycle: Lifecycle }>,
  defs: BothDefs,
): readonly Difference[] {
  const compared = comparedShapesOf(pair);
  if (compared === undefined) {
    return [];
  }
  const bodies = { baseline: compared.baseline.body, proposed: compared.proposed.body };
  return schemaDifferencesOf(bodies, defs, { position: 'message', at: partsOf('body') });
}
