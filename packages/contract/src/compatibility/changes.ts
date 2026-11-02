import { canonicalJson } from '../walker/index.ts';
import { classificationOf } from './classes.ts';
import type { Change, ChangeSite, Difference, SiteDifferences } from './report.ts';

/** The differences found at each site, in order, each classified as a Change. */
export function siteChangesOf(sites: readonly SiteDifferences[]): readonly Change[] {
  return sites.flatMap(({ site, differences }) => changesAt(site, differences));
}

/**
 * The differences found at a site, in the order the rules ran, each classified as a Change. Two
 * schema Differences at one place, with one Position and one shape, are one Change, the first
 * found.
 */
export function changesAt(site: ChangeSite, found: readonly (Difference | undefined)[]): Change[] {
  return firstPlacedOf(found.filter(isFound)).map((difference) => ({
    site,
    difference,
    ...classificationOf(site, difference),
  }));
}

function isFound(difference: Difference | undefined): difference is Difference {
  return difference !== undefined;
}

/** The differences with each schema Difference once, the first found at its place, Position and shape. */
function firstPlacedOf(differences: readonly Difference[]): Difference[] {
  const seen = new Set<string>();
  const first: Difference[] = [];
  for (const difference of differences) {
    if (difference.kind === 'schema') {
      const { position, def, at, shape } = difference;
      const placed = canonicalJson({ position, def, at, shape });
      if (seen.has(placed)) {
        continue;
      }
      seen.add(placed);
    }
    first.push(difference);
  }
  return first;
}
