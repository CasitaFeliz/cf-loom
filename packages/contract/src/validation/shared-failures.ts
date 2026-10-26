import type { $ZodType } from 'zod/v4/core';
import {
  byCodePoint,
  type NotAllowed,
  type Site,
  sameSite,
  siteLocationOf,
} from '../walker/index.ts';
import type { NotAllowedFailure } from './failures.ts';

/**
 * What the walk refused, as one failure for each construct of each schema: a schema several
 * places reach is told once, at the first place in code point order, with the other sites that
 * reach it.
 */
export function notAllowedFailuresOf(
  refusals: readonly NotAllowed[],
): readonly NotAllowedFailure[] {
  return reachesOf(refusals).map(failureOf);
}

/** The refusals grouped by the schema and the construct, the groups in the order they were first met. */
function reachesOf(refusals: readonly NotAllowed[]): readonly (readonly NotAllowed[])[] {
  const bySchema = new Map<$ZodType, Map<string, NotAllowed[]>>();
  const groups: NotAllowed[][] = [];
  for (const refusal of refusals) {
    const byConstruct = bySchema.get(refusal.schema) ?? new Map<string, NotAllowed[]>();
    bySchema.set(refusal.schema, byConstruct);
    const same = byConstruct.get(refusal.construct);
    if (same === undefined) {
      const group = [refusal];
      byConstruct.set(refusal.construct, group);
      groups.push(group);
    } else {
      same.push(refusal);
    }
  }
  return groups;
}

function failureOf(group: readonly NotAllowed[]): NotAllowedFailure {
  const [first, ...others] = [...group].sort(byLocation);
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
  return byCodePoint(
    siteLocationOf(left.site, left.steps),
    siteLocationOf(right.site, right.steps),
  );
}

/** The sites, other than the first's, that reach the schema, each once, in the order given. */
function otherSitesOf(first: Site, others: readonly NotAllowed[]): readonly Site[] {
  const sites: Site[] = [];
  for (const { site } of others) {
    if (!sameSite(site, first) && !sites.some((known) => sameSite(known, site))) {
      sites.push(site);
    }
  }
  return sites;
}
