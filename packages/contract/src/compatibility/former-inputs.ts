import type {
  EndpointSnapshot,
  FormerInput,
  PublishedServiceSnapshot,
  ServiceSnapshot,
} from '../snapshot/index.ts';
import type { Defs } from '../walker/index.ts';
import { classificationOf } from './classes.ts';
import { endpointSiteOf, inputBodyDifferencesOf, queryDifferencesOf } from './endpoints.ts';
import { type GraftSource, graftedInputOf } from './grafting.ts';
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
 * named by the `removedIn` of the former Input it was found against: its Callers still send that
 * Input.
 */
export function formerInputDifferencesOf(
  pair: Pair<EndpointSnapshot>,
  checked: CheckedService,
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
  return newestFirst.flatMap((former) => taggedBreakingOf(former, endpoint));
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
  checked: CheckedService,
  version: string,
): readonly FormerInput[] {
  const { baseline, proposed } = checked;
  return pairsOf(baseline.endpoints, proposed.endpoints).flatMap((pair) =>
    keptFormerInputsOf(pair, checked, version),
  );
}

/** A former Input to rewrite, under the heading it is kept with. */
type Rewritten = Pick<FormerInput, 'endpoint' | 'removedIn'> & { readonly source: GraftSource };

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
  const own: Rewritten = {
    endpoint: pair.identity,
    removedIn: version,
    source: { input: { query, body }, defs: checked.baseline.defs },
  };
  const stored = (checked.formers.get(pair.identity) ?? []).map(
    (former): Rewritten => ({
      endpoint: former.endpoint,
      removedIn: former.removedIn,
      source: { input: former.input, defs: former.defs },
    }),
  );
  const onto = { input: compared.proposed.input, defs: checked.proposed.defs };
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
