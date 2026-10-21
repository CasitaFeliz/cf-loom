import type { Visibility } from '../declarations/index.ts';
import type { Pair } from './pairs.ts';
import type { Difference } from './report.ts';

type Visible = { readonly visibility: Visibility };

/** Whether an Element's Visibility widened or narrowed from the Baseline's. */
export function visibilityDifferenceOf(pair: Pair<Visible>): Difference | undefined {
  if (pair.kind !== 'kept') {
    return undefined;
  }
  const from = pair.baseline.visibility;
  const to = pair.proposed.visibility;
  if (widthOf(to) === widthOf(from)) {
    return undefined;
  }
  return widthOf(to) > widthOf(from)
    ? { kind: 'visibility-widened', from, to }
    : { kind: 'visibility-narrowed', from, to };
}

/**
 * The Visibility that decides the bump of a Change on an Element: the wider of the Baseline's and
 * the proposed one when it is on both sides, else the side it is on.
 */
export function siteVisibilityOf(pair: Pair<Visible>): Visibility {
  switch (pair.kind) {
    case 'added':
    case 'reused':
      return pair.proposed.visibility;
    case 'dropped':
      return pair.baseline.visibility;
    case 'kept':
      return widthOf(pair.proposed.visibility) > widthOf(pair.baseline.visibility)
        ? pair.proposed.visibility
        : pair.baseline.visibility;
  }
}

function widthOf(visibility: Visibility): number {
  switch (visibility) {
    case 'private':
      return 0;
    case 'internal':
      return 1;
    case 'public':
      return 2;
  }
}
