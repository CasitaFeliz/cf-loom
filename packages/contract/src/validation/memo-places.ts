import {
  byCodePoint,
  type Memo,
  movedFrom,
  type Place,
  type Site,
  sameSite,
  siteLocationOf,
  siteTextOf,
} from '../walker/index.ts';

/**
 * Where each schema the walk remembers is told: from the first place it is reached, in code point
 * order, and with every site that reaches it, through the remembered schemas it is reached inside.
 */
export type MemoPlaces = {
  /** The first place the memo is reached at, among the places of one site when one is given. */
  readonly firstOf: (memo: Memo, site?: Site) => Place;
  readonly sitesOf: (memo: Memo) => readonly Site[];
};

/** The places of the memos of one walk, each settled once and kept. */
export function memoPlaces(): MemoPlaces {
  const firstBySite = new Map<string, Settling>();
  const sites = new Map<Memo, readonly Site[]>();
  return {
    firstOf: (memo, site) => {
      const key = site === undefined ? '' : siteTextOf(site);
      const settling = firstBySite.get(key) ?? { site, first: new Map() };
      firstBySite.set(key, settling);
      return firstOf(settling, memo);
    },
    sitesOf: (memo) => {
      const known = sites.get(memo) ?? sitesOf(memo);
      sites.set(memo, known);
      return known;
    },
  };
}

/** The code point order of the places a line would name. */
export function byLocation(left: Place, right: Place): number {
  return byCodePoint(locationTextOf(left), locationTextOf(right));
}

/** The text a line names a place by: its site and the steps under it. */
export function locationTextOf({ site, steps }: Place): string {
  return siteLocationOf(site, steps);
}

/** The first places settled so far, from the places of one site or of all. */
type Settling = { readonly site: Site | undefined; readonly first: Map<Memo, Place> };

/**
 * Memos settle in code point order of their first place: the smallest place any unsettled memo
 * is reached at is final, since a place inside a memo only extends that memo's.
 */
function firstOf(settling: Settling, memo: Memo): Place {
  const { first } = settling;
  const settled = first.get(memo);
  if (settled !== undefined) {
    return settled;
  }
  const unsettled = new Set([...around(memo)].filter((other) => !first.has(other)));
  for (;;) {
    const smallest = smallestReachOf(unsettled, settling);
    first.set(smallest.memo, smallest.at);
    unsettled.delete(smallest.memo);
    if (smallest.memo === memo) {
      return smallest.at;
    }
  }
}

/** The smallest place any of the memos is reached at, among the reaches already placed. */
function smallestReachOf(
  memos: ReadonlySet<Memo>,
  settling: Settling,
): { readonly memo: Memo; readonly at: Place } {
  const placed = [...memos].flatMap((memo) =>
    memo.reaches.map((reach) => ({ memo, at: placeOf(reach, settling) })),
  );
  const [smallest] = placed.filter(isPlaced).sort((left, right) => byLocation(left.at, right.at));
  if (smallest === undefined) {
    throw new Error('A remembered schema is reached from no place: a bug.');
  }
  return smallest;
}

/** The place a reach stands at once the memo it was made inside is placed, else none yet. */
function placeOf(reach: Memo['reaches'][number], { site, first }: Settling): Place | undefined {
  if (reach.within === undefined) {
    return site === undefined || sameSite(site, reach.at.site) ? reach.at : undefined;
  }
  const outer = first.get(reach.within);
  return outer === undefined ? undefined : movedFrom(reach.at, reach.within.at, outer);
}

function isPlaced<Item extends { readonly at: Place | undefined }>(
  item: Item,
): item is Item & { readonly at: Place } {
  return item.at !== undefined;
}

/** Every site the memo is reached from, through the memos it is reached inside. */
function sitesOf(memo: Memo): readonly Site[] {
  const sites: Site[] = [];
  for (const other of around(memo)) {
    for (const { at, within } of other.reaches) {
      if (within === undefined && !sites.some((site) => sameSite(site, at.site))) {
        sites.push(at.site);
      }
    }
  }
  return sites;
}

/** The memo and every memo it is reached inside, at any depth. */
function around(memo: Memo): ReadonlySet<Memo> {
  const seen = new Set<Memo>();
  const pending = [memo];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    if (!seen.has(next)) {
      seen.add(next);
      pending.push(...next.reaches.map(({ within }) => within).filter(isMemo));
    }
  }
  return seen;
}

function isMemo(memo: Memo | undefined): memo is Memo {
  return memo !== undefined;
}
