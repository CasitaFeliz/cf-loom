import { isLive, type Visibility } from '../declarations/index.ts';
import {
  type EndpointSnapshot,
  isDeclared,
  type PublishedServiceSnapshot,
  type ServiceSnapshot,
} from '../snapshot/index.ts';
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
    case 'retired':
      return widerOf(pair.baseline.visibility, pair.proposed.visibility);
  }
}

/** The wider of two Visibilities, the one that reaches further. */
export function widerOf(left: Visibility, right: Visibility): Visibility {
  return widthOf(right) > widthOf(left) ? right : left;
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

/**
 * The widest Visibility of the declared Endpoints of either Snapshot that name each key, so a
 * Change to what they name reaches every Consumer that can see one; a Retired Endpoint answers
 * only `RETIRED`, so it counts toward none.
 */
export function widestVisibilitiesOf(
  baseline: PublishedServiceSnapshot,
  proposed: ServiceSnapshot,
  namesOf: (endpoint: EndpointSnapshot) => readonly string[],
): ReadonlyMap<string, Visibility> {
  return widestOf(liveEndpointsOf(baseline, proposed), namesOf);
}

/**
 * The widest Visibility of the Endpoints and Events of either Snapshot, those Retired left out,
 * that each Group lists; a Command or a Subscription is Private, so it widens none.
 */
export function widestGroupVisibilitiesOf(
  baseline: PublishedServiceSnapshot,
  proposed: ServiceSnapshot,
): ReadonlyMap<string, Visibility> {
  const events = [
    ...Object.values(baseline.events).filter(isDeclared),
    ...Object.values(proposed.events),
  ].filter(isLive);
  const listed = [...liveEndpointsOf(baseline, proposed), ...events];
  return widestOf(listed, (element) => [element.group]);
}

/** The Endpoints of either Snapshot that are declared and not Retired. */
function liveEndpointsOf(
  baseline: PublishedServiceSnapshot,
  proposed: ServiceSnapshot,
): readonly EndpointSnapshot[] {
  return [
    ...Object.values(baseline.endpoints).filter(isDeclared),
    ...Object.values(proposed.endpoints),
  ].filter(isLive);
}

function widestOf<Element extends Visible>(
  elements: readonly Element[],
  namesOf: (element: Element) => readonly string[],
): ReadonlyMap<string, Visibility> {
  const visibilities = new Map<string, Visibility>();
  for (const element of elements) {
    for (const name of namesOf(element)) {
      visibilities.set(name, widerOf(visibilities.get(name) ?? 'private', element.visibility));
    }
  }
  return visibilities;
}
