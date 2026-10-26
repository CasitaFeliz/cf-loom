import {
  byCodePoint,
  type Memo,
  movedFrom,
  type NotAllowed,
  type Place,
  type Site,
  sameSite,
  siteTextOf,
  type WalkedSchemas,
} from '../walker/index.ts';
import type { NotAllowedFailure } from './failures.ts';
import { loopPlacesOf } from './loop-places.ts';
import { byLocation, locationTextOf, type MemoPlaces, memoPlaces } from './memo-places.ts';

/**
 * A refusal told where the author reads it, and every site that reaches it; `foldedBy` is what
 * its tellings are folded across: the schema refused, or the one site a cycle is told at.
 */
type Told = {
  readonly refusal: NotAllowed;
  readonly at: Place;
  readonly sites: readonly Site[];
  readonly foldedBy: unknown;
};

/** What the walk remembers, so a refusal is told at the places that reach it. */
type Remembered = Pick<WalkedSchemas, 'memoOf' | 'loopOf'>;

/**
 * What the walk refused, as one line for each construct at each location: a refusal inside a
 * remembered schema is told from the first place that schema is reached, with every site that
 * reaches it; a schema several places reach is told once, at the first of them in code point
 * order, with the other sites; a cycle no id names is told at each site that meets it.
 */
export function notAllowedFailuresOf(
  refusals: readonly NotAllowed[],
  remembered: Remembered,
): readonly NotAllowedFailure[] {
  const places = memoPlaces();
  const told = [...new Set(refusals)].flatMap((refusal) => tellingsOf(refusal, remembered, places));
  const bySchema = groupedBy(
    told,
    ({ foldedBy }) => foldedBy,
    ({ refusal }) => refusal.construct,
  );
  const firsts = bySchema.map(firstOfGroup);
  const byLine = groupedBy(
    firsts,
    ({ at }) => locationTextOf(at),
    ({ refusal }) => refusal.construct,
  );
  return byLine.map(firstOfGroup).map(failureOf);
}

/** A refused cycle no id names, told at each site that meets it; any other refusal, once. */
function tellingsOf(refusal: NotAllowed, remembered: Remembered, places: MemoPlaces): Told[] {
  const loop = remembered.loopOf.get(refusal);
  if (loop === undefined) {
    return [toldOf(refusal, remembered.memoOf.get(refusal), places)];
  }
  return loopPlacesOf(refusal, loop, places).map((at) => ({
    refusal,
    at,
    sites: [at.site],
    foldedBy: siteTextOf(at.site),
  }));
}

/** A refusal told at its place, or, raised inside a remembered schema, from that schema's first place. */
function toldOf(refusal: NotAllowed, memo: Memo | undefined, places: MemoPlaces): Told {
  const foldedBy = refusal.schema;
  if (memo === undefined) {
    return { refusal, at: refusal, sites: [refusal.site], foldedBy };
  }
  const at = movedFrom(refusal, memo.at, places.firstOf(memo));
  return { refusal, at, sites: places.sitesOf(memo), foldedBy };
}

/** The items grouped by two keys, the groups in the order each was first met. */
function groupedBy<Item, Outer>(
  items: readonly Item[],
  outerOf: (item: Item) => Outer,
  innerOf: (item: Item) => string,
): readonly (readonly Item[])[] {
  const byOuter = new Map<Outer, Map<string, Item[]>>();
  const groups: Item[][] = [];
  for (const item of items) {
    const byInner = byOuter.get(outerOf(item)) ?? new Map<string, Item[]>();
    byOuter.set(outerOf(item), byInner);
    const same = byInner.get(innerOf(item));
    if (same === undefined) {
      const group = [item];
      byInner.set(innerOf(item), group);
      groups.push(group);
    } else {
      same.push(item);
    }
  }
  return groups;
}

/** One telling for a group: at the first location in code point order, with every site of the group once. */
function firstOfGroup(group: readonly Told[]): Told {
  const [first, ...others] = [...group].sort((left, right) => byLocation(left.at, right.at));
  if (first === undefined) {
    throw new Error('A construct that is not allowed is reached from at least one place: a bug.');
  }
  const sites: Site[] = [];
  for (const site of [first, ...others].flatMap((told) => told.sites)) {
    if (!sites.some((known) => sameSite(known, site))) {
      sites.push(site);
    }
  }
  return { ...first, sites };
}

function failureOf({ refusal, at, sites }: Told): NotAllowedFailure {
  const { construct, instead, origin } = refusal;
  return {
    kind: 'not-allowed',
    site: at.site,
    steps: at.steps,
    construct,
    ...(instead !== undefined && { instead }),
    declaration: at.declaration,
    alsoIn: sites
      .filter((site) => !sameSite(site, at.site))
      .sort((left, right) => byCodePoint(siteTextOf(left), siteTextOf(right))),
    origin,
  };
}
