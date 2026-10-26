import type { $ZodType } from 'zod/v4/core';
import {
  byCodePoint,
  type NotAllowed,
  type Site,
  siteLocationOf,
  siteTextOf,
} from '../walker/index.ts';
import type { NotAllowedFailure } from './failures.ts';

/**
 * What the walk refused, as one failure for each construct of each schema: a schema several places
 * reach is told once, at the first place in code point order, with the other sites that reach it.
 * A construct that holds no schema of its own is a failure of its own.
 */
export function notAllowedFailuresOf(
  refusals: readonly NotAllowed[],
): readonly NotAllowedFailure[] {
  const bySchema = new Map<$ZodType, Map<string, NotAllowed[]>>();
  const reached: NotAllowed[][] = [];
  for (const refusal of refusals) {
    const sameConstruct = reachedOf(bySchema, refusal);
    if (sameConstruct.length === 0) {
      reached.push(sameConstruct);
    }
    sameConstruct.push(refusal);
  }
  return reached.map(failureOf);
}

/** The refusals already met of the construct of the schema, a new list when there are none; a construct with no schema gets a list of its own. */
function reachedOf(
  bySchema: Map<$ZodType, Map<string, NotAllowed[]>>,
  { schema, construct }: NotAllowed,
): NotAllowed[] {
  if (schema === undefined) {
    return [];
  }
  const byConstruct = bySchema.get(schema) ?? new Map<string, NotAllowed[]>();
  const sameConstruct = byConstruct.get(construct) ?? [];
  byConstruct.set(construct, sameConstruct);
  bySchema.set(schema, byConstruct);
  return sameConstruct;
}

function failureOf(refusals: readonly NotAllowed[]): NotAllowedFailure {
  const [first, ...others] = [...refusals].sort(byLocation);
  if (first === undefined) {
    throw new Error('A construct that is not allowed is reached from at least one place: a bug.');
  }
  const { site, steps, construct, instead, declaration, origin } = first;
  return {
    kind: 'not-allowed',
    site,
    steps,
    construct,
    ...(instead !== undefined && { instead }),
    declaration,
    alsoIn: otherSitesOf(site, others),
    origin,
  };
}

function byLocation(left: NotAllowed, right: NotAllowed): number {
  return byCodePoint(locationOf(left), locationOf(right));
}

function locationOf({ site, steps }: NotAllowed): string {
  return siteLocationOf(site, steps);
}

/** The sites, other than the first's, that reach the schema, each once, in the order given. */
function otherSitesOf(first: Site, others: readonly NotAllowed[]): readonly Site[] {
  const texts = new Set([siteTextOf(first)]);
  const sites: Site[] = [];
  for (const { site } of others) {
    const text = siteTextOf(site);
    if (!texts.has(text)) {
      texts.add(text);
      sites.push(site);
    }
  }
  return sites;
}
