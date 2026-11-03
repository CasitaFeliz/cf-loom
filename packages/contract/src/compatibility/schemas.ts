import { chainDown, type Step, stepListOf } from '../walker/index.ts';
import type { BothDefs, NodePair } from './findings.ts';
import { pairWalkOf, type Walked } from './pair-walk.ts';
import type { Difference, EndpointPosition, Position } from './report.ts';

/** Where a schema sits: the Position it is read in, and its steps from the site. */
export type SchemaPlace = { readonly position: Position; readonly at: readonly Step[] };

/**
 * Where a schema read as Input or Success sits: an Endpoint's part, a Guard's demand or a
 * Rejection's body; never a Message's or a shared schema's.
 */
export type EndpointPlace = { readonly position: EndpointPosition; readonly at: readonly Step[] };

/**
 * Every difference in shape between a Baseline schema and its proposed one, in the order one pair
 * walk of its own finds them, each at its path: what differs inside the def the proposed side names
 * is at its path from that def, so it reads the same whichever path reaches the def first.
 */
export function schemaDifferencesOf(
  pair: NodePair,
  defs: BothDefs,
  place: SchemaPlace,
): readonly Difference[] {
  const differences: Difference[] = [];
  for (const walked of pairWalkOf(defs).pairsFrom(pair, place.at)) {
    if (walked.kind === 'found') {
      differences.push(differenceOf(place.position, walked));
    }
  }
  return differences;
}

/** A finding as a Difference: its steps below the pair it was found in, and the def the pair is in, if any. */
function differenceOf(
  position: Position,
  { in: met, finding }: Extract<Walked, { kind: 'found' }>,
): Difference {
  const at = stepListOf(chainDown(met.steps, finding.steps));
  const difference = { kind: 'schema', position, at, shape: finding.shape } as const;
  return met.def === undefined ? difference : { ...difference, def: met.def };
}
