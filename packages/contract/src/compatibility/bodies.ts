import type { Path, SchemaNode } from '../walker/index.ts';
import type { BothDefs } from './findings.ts';
import type { Pair } from './pairs.ts';
import type { BodyPosition, Difference } from './report.ts';
import { schemaDifferencesOf } from './schemas.ts';

/** A body of the Baseline and the proposed one, `null` where none is declared. */
export type Bodies = {
  readonly baseline: SchemaNode | null;
  readonly proposed: SchemaNode | null;
};

/** Where an Endpoint's body is judged: the Position it is read in, and its path from the site. */
export type BodyPlace = { readonly position: BodyPosition; readonly at: Path };

/**
 * A body declared on one side only is added or removed; one on both sides is compared by its
 * schema in its Position. An undeclared body is never read, so a Caller sends or reads none.
 */
export function bodyDifferencesOf(
  { baseline, proposed }: Bodies,
  defs: BothDefs,
  place: BodyPlace,
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

/** A Message Version's body Differences, read as Message. */
export function messageBodyDifferencesOf(
  pair: Pair<{ readonly body: SchemaNode }>,
  defs: BothDefs,
): readonly Difference[] {
  if (pair.kind !== 'kept') {
    return [];
  }
  const bodies = { baseline: pair.baseline.body, proposed: pair.proposed.body };
  return schemaDifferencesOf(bodies, defs, { position: 'message', at: ['body'] });
}
