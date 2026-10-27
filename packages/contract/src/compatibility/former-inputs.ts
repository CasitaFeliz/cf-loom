import {
  type EndpointSnapshot,
  type FormerInput,
  formerInputsOf,
  inputNodesOf,
  type PublishedServiceSnapshot,
  type ServiceSnapshot,
} from '../snapshot/index.ts';
import { canonicalJson, type Defs, defsReachedOf } from '../walker/index.ts';
import { classificationOf } from './classes.ts';
import { endpointSiteOf, inputBodyDifferencesOf, queryDifferencesOf } from './endpoints.ts';
import { comparedShapesOf, type Pair, pairsOf } from './pairs.ts';
import type { ChangeSite, Difference } from './report.ts';

/** A Service's Baseline and the declared Snapshot checked against it. */
export type CheckedService = {
  readonly baseline: PublishedServiceSnapshot;
  readonly proposed: ServiceSnapshot;
};

type SchemaDifference = Extract<Difference, { readonly kind: 'schema' }>;

/**
 * The Breaking Differences of an Endpoint's query and body against its former Inputs, newest first,
 * each once and none already reported against the Baseline, named by the `removedIn` of the former
 * Input it was found against: its Callers still send that Input.
 */
export function formerInputDifferencesOf(
  pair: Pair<EndpointSnapshot>,
  checked: CheckedService,
  reported: readonly Difference[],
): readonly Difference[] {
  const compared = comparedShapesOf(pair);
  if (compared === undefined) {
    return [];
  }
  const site = endpointSiteOf(pair);
  const seen = new Set(reported.filter(isSchemaDifference).map(placedShapeOf));
  const found: Difference[] = [];
  const newestFirst = [...formerInputsOf(checked.baseline, pair.identity)].reverse();
  for (const former of newestFirst) {
    const differences = differencesAgainst(former, compared.proposed, checked.proposed.defs);
    for (const difference of differences.filter(isSchemaDifference)) {
      const placed = placedShapeOf(difference);
      if (isBreakingAt(site, difference) && !seen.has(placed)) {
        seen.add(placed);
        found.push({ ...difference, removedIn: former.removedIn });
      }
    }
  }
  return found;
}

/**
 * The former Inputs a publish keeps, by Endpoint in code point order, each Endpoint's in the order
 * recorded: of each Endpoint kept by identity and not Retired now, the Baseline's former Inputs and
 * its own query and body, removed in this version, that the Endpoint still keeps apart.
 */
export function formerInputsMerged(
  baseline: PublishedServiceSnapshot | undefined,
  proposed: ServiceSnapshot,
  version: string,
): readonly FormerInput[] {
  if (baseline === undefined) {
    return [];
  }
  const checked = { baseline, proposed };
  return pairsOf(baseline.endpoints, proposed.endpoints).flatMap((pair) =>
    keptFormerInputsOf(pair, checked, version),
  );
}

function keptFormerInputsOf(
  pair: Pair<EndpointSnapshot>,
  checked: CheckedService,
  version: string,
): readonly FormerInput[] {
  const compared = comparedShapesOf(pair);
  if (compared === undefined) {
    return [];
  }
  const site = endpointSiteOf(pair);
  const { query, body } = compared.baseline.input;
  const own: FormerInput = {
    endpoint: pair.identity,
    removedIn: version,
    input: { query, body },
    defs: defsReachedOf(inputNodesOf({ query, body }), checked.baseline.defs),
  };
  const held = [...formerInputsOf(checked.baseline, pair.identity), own];
  return held.filter((former) =>
    isKeptApart(differencesAgainst(former, compared.proposed, checked.proposed.defs), site),
  );
}

/**
 * Whether an Endpoint keeps a former Input apart: it still lacks a field of it, so the Baseline does
 * not stand for that Input's Callers, and nothing it declares is Breaking against it, so no approved
 * break is reported again.
 */
function isKeptApart(differences: readonly Difference[], site: ChangeSite): boolean {
  const isBreaking = differences.some((difference) => isBreakingAt(site, difference));
  return differences.some(isFieldRemoved) && !isBreaking;
}

/** A former Input's query and body compared with an Endpoint's, as a kept Endpoint's are. */
function differencesAgainst(
  former: FormerInput,
  proposed: EndpointSnapshot,
  proposedDefs: Defs,
): readonly Difference[] {
  const defs = { baseline: former.defs, proposed: proposedDefs };
  return [
    ...queryDifferencesOf(former.input, proposed.input, defs),
    ...inputBodyDifferencesOf(former.input, proposed.input, defs),
  ];
}

function isBreakingAt(site: ChangeSite, difference: Difference): boolean {
  return classificationOf(site, difference).class === 'breaking';
}

function isFieldRemoved(difference: Difference): boolean {
  return difference.kind === 'schema' && difference.shape.kind === 'field-removed';
}

function isSchemaDifference(difference: Difference): difference is SchemaDifference {
  return difference.kind === 'schema';
}

/** Where a schema Difference is and what it is, the same for the same Difference found twice. */
function placedShapeOf({ at, shape }: SchemaDifference): string {
  return canonicalJson([at, shape]);
}
