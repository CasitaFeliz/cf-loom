import { canonicalJson } from '../walker/index.ts';
import { classificationOf } from './classes.ts';
import type { Change, ChangeSite, Difference, SiteDifferences } from './report.ts';

/** The differences found at each site, in order, each classified as a Change. */
export function siteChangesOf(sites: readonly SiteDifferences[]): readonly Change[] {
  return sites.flatMap(({ site, differences }) => changesAt(site, differences));
}

/**
 * The differences found at a site, in the order the rules ran, each classified as a Change. A
 * schema Difference found again with the same Position, path and shape is one Change, the first:
 * two paths reach one def, and a former Input is compared with the same defs.
 */
export function changesAt(site: ChangeSite, found: readonly (Difference | undefined)[]): Change[] {
  const seen = new Set<string>();
  return found
    .filter(isFound)
    .filter((difference) => isFirstPlaced(difference, seen))
    .map((difference) => ({ site, difference, ...classificationOf(site, difference) }));
}

function isFound(difference: Difference | undefined): difference is Difference {
  return difference !== undefined;
}

function isFirstPlaced(difference: Difference, seen: Set<string>): boolean {
  if (difference.kind !== 'schema') {
    return true;
  }
  const { position, def, at, shape } = difference;
  const placed = canonicalJson({ position, def, at, shape });
  const isFirst = !seen.has(placed);
  seen.add(placed);
  return isFirst;
}
