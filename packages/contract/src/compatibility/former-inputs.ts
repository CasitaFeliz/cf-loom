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
import { graftedInputOf } from './grafting.ts';
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
  const endpoint = {
    site: endpointSiteOf(pair),
    proposed: compared.proposed,
    defs: checked.proposed.defs,
  };
  const newestFirst = [...formerInputsOf(checked.baseline, pair.identity)].reverse();
  const tagged = newestFirst.flatMap((former) => taggedBreakingOf(former, endpoint));
  const seen = new Set(reported.filter(isSchemaDifference).map(placedShapeOf));
  const found: Difference[] = [];
  for (const difference of tagged) {
    const placed = placedShapeOf(difference);
    if (!seen.has(placed)) {
      seen.add(placed);
      found.push(difference);
    }
  }
  return found;
}

/** An Endpoint as the Check compares it with a former Input: its site, its declaration and the defs its `ref`s name. */
type CheckedEndpoint = {
  readonly site: ChangeSite;
  readonly proposed: EndpointSnapshot;
  readonly defs: Defs;
};

/** The Breaking schema Differences of an Endpoint against one former Input, each with its `removedIn`. */
function taggedBreakingOf(
  former: FormerInput,
  endpoint: CheckedEndpoint,
): readonly SchemaDifference[] {
  const differences = differencesAgainst(former, endpoint.proposed, endpoint.defs);
  const breaking = differences
    .filter(isSchemaDifference)
    .filter((difference) => isBreakingAt(endpoint.site, difference));
  return breaking.map((difference) => ({ ...difference, removedIn: former.removedIn }));
}

/**
 * The former Inputs a publish keeps, by Endpoint in code point order, each Endpoint's in the order
 * recorded: of each Endpoint kept by identity and not Retired now, the Baseline's former Inputs and
 * its own query and body, removed in this version, each rewritten onto the Endpoint's query and
 * body, kept while it grafts a field.
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
  const { query, body } = compared.baseline.input;
  const own: FormerInput = {
    endpoint: pair.identity,
    removedIn: version,
    input: { query, body },
    defs: defsReachedOf(inputNodesOf({ query, body }), checked.baseline.defs),
  };
  const onto = { input: compared.proposed.input, defs: checked.proposed.defs };
  const kept: FormerInput[] = [];
  for (const former of [...formerInputsOf(checked.baseline, pair.identity), own]) {
    const grafted = graftedInputOf(former, onto);
    if (grafted !== undefined) {
      kept.push({ endpoint: former.endpoint, removedIn: former.removedIn, ...grafted });
    }
  }
  return kept;
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

function isSchemaDifference(difference: Difference): difference is SchemaDifference {
  return difference.kind === 'schema';
}

/** Where a schema Difference is and what it is, the same for the same Difference found twice. */
function placedShapeOf({ at, shape }: SchemaDifference): string {
  return canonicalJson([at, shape]);
}
