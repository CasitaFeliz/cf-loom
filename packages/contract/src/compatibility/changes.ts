import { classificationOf } from './classes.ts';
import type { Change, ChangeSite, Difference, SiteDifferences } from './report.ts';

/** The differences found at each site, in order, each classified as a Change. */
export function siteChangesOf(sites: readonly SiteDifferences[]): readonly Change[] {
  return sites.flatMap(({ site, differences }) => changesAt(site, differences));
}

/** The differences found at a site, in the order the rules ran, each classified as a Change. */
export function changesAt(site: ChangeSite, found: readonly (Difference | undefined)[]): Change[] {
  return found.filter(isFound).map((difference) => ({
    site,
    difference,
    ...classificationOf(site, difference),
  }));
}

function isFound(difference: Difference | undefined): difference is Difference {
  return difference !== undefined;
}
