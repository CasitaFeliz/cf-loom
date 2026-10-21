import type { EndpointSnapshot } from '../snapshot/index.ts';
import type { Defs, SchemaNode } from '../walker/index.ts';
import type { BothDefs } from './findings.ts';
import type { Pair } from './pairs.ts';
import type { Difference } from './report.ts';
import { type SchemaPlace, schemaDifferencesOf } from './schemas.ts';

type Bodies = {
  readonly baseline: SchemaNode | null;
  readonly proposed: SchemaNode | null;
};

/** The defs of the Baseline's Snapshot and of the proposed one, which their schemas' `ref`s name. */
export function bothDefsOf(
  baseline: { readonly defs: Defs },
  proposed: { readonly defs: Defs },
): BothDefs {
  return { baseline: baseline.defs, proposed: proposed.defs };
}

/**
 * An Endpoint's body Differences: its Input body read as Input, then its Success body as Success.
 * A body that one side lacks is left to the Endpoint rules.
 */
export function endpointBodyDifferencesOf(
  pair: Pair<EndpointSnapshot>,
  defs: BothDefs,
): readonly Difference[] {
  if (pair.kind !== 'kept') {
    return [];
  }
  const { baseline, proposed } = pair;
  const input: Bodies = { baseline: baseline.input.body, proposed: proposed.input.body };
  const success: Bodies = { baseline: baseline.success.body, proposed: proposed.success.body };
  return [
    ...bodyDifferencesOf(input, defs, { position: 'input', at: ['input', 'body'] }),
    ...bodyDifferencesOf(success, defs, { position: 'success', at: ['success', 'body'] }),
  ];
}

/** A Message Version's body Differences, read as Message. */
export function messageBodyDifferencesOf(
  pair: Pair<{ readonly body: SchemaNode }>,
  defs: BothDefs,
): readonly Difference[] {
  if (pair.kind !== 'kept') {
    return [];
  }
  const bodies: Bodies = { baseline: pair.baseline.body, proposed: pair.proposed.body };
  return bodyDifferencesOf(bodies, defs, { position: 'message', at: ['body'] });
}

function bodyDifferencesOf(
  { baseline, proposed }: Bodies,
  defs: BothDefs,
  place: SchemaPlace,
): readonly Difference[] {
  if (baseline === null || proposed === null) {
    return [];
  }
  return schemaDifferencesOf({ baseline, proposed }, defs, place);
}
