import type {
  EndpointSnapshot,
  FormerInput,
  PublishedServiceSnapshot,
  ServiceSnapshot,
} from '../snapshot/index.ts';
import { canonicalJson, type Defs } from '../walker/index.ts';
import { classificationOf } from './classes.ts';
import { endpointSiteOf, inputBodyDifferencesOf, queryDifferencesOf } from './endpoints.ts';
import { type GraftSource, graftedInputOf, type ReadDefs, readDefsOf } from './grafting.ts';
import { comparedShapesOf, type Pair, pairsOf } from './pairs.ts';
import type { ChangeSite, Difference } from './report.ts';

/** A Service's Baseline and the declared Snapshot checked against it, and the Baseline's former Inputs by Endpoint, oldest first. */
export type CheckedService = {
  readonly baseline: PublishedServiceSnapshot;
  readonly proposed: ServiceSnapshot;
  readonly formers: ReadonlyMap<string, readonly FormerInput[]>;
};

/** A Service's Baseline and the declared Snapshot to check against it, with the Baseline's former Inputs grouped once. */
export function checkedServiceOf(
  baseline: PublishedServiceSnapshot,
  proposed: ServiceSnapshot,
): CheckedService {
  return {
    baseline,
    proposed,
    formers: Map.groupBy(baseline.formerInputs, (former) => former.endpoint),
  };
}

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
  const newestFirst = (checked.formers.get(pair.identity) ?? []).toReversed();
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
  const merge = {
    checked: checkedServiceOf(baseline, proposed),
    read: { baseline: readDefsOf(baseline.defs), proposed: readDefsOf(proposed.defs) },
  };
  return pairsOf(baseline.endpoints, proposed.endpoints).flatMap((pair) =>
    keptFormerInputsOf(pair, merge, version),
  );
}

/** The Check of a merge: the Service and its Baseline, and the reader of each one's alias defs, built once for the merge. */
type Merge = {
  readonly checked: CheckedService;
  readonly read: { readonly baseline: ReadDefs; readonly proposed: ReadDefs };
};

/** A former Input to rewrite, under the heading it is kept with. */
type Rewritten = Pick<FormerInput, 'endpoint' | 'removedIn'> & { readonly source: GraftSource };

function keptFormerInputsOf(
  pair: Pair<EndpointSnapshot>,
  merge: Merge,
  version: string,
): readonly FormerInput[] {
  const compared = comparedShapesOf(pair);
  if (compared === undefined) {
    return [];
  }
  const { query, body } = compared.baseline.input;
  const own: Rewritten = {
    endpoint: pair.identity,
    removedIn: version,
    source: { input: { query, body }, ...merge.read.baseline },
  };
  const stored = (merge.checked.formers.get(pair.identity) ?? []).map(
    (former): Rewritten => ({
      endpoint: former.endpoint,
      removedIn: former.removedIn,
      source: { input: former.input, ...readDefsOf(former.defs) },
    }),
  );
  const onto = { input: compared.proposed.input, ...merge.read.proposed };
  const kept: FormerInput[] = [];
  for (const { source, ...heading } of [...stored, own]) {
    const grafted = graftedInputOf(source, onto);
    if (grafted !== undefined) {
      kept.push({ ...heading, ...grafted });
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
