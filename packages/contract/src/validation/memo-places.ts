import {
  byCodePoint,
  locationBelowOf,
  type Memo,
  movedFrom,
  type Place,
  type Site,
  siteLocationOf,
  siteTextOf,
} from '../walker/index.ts';
import { type PlacedReach, popReach, pushReach } from './reach-heap.ts';

/** Every site of a set once, keyed by the text a line names it by. */
export type Sites = ReadonlyMap<string, Site>;

/**
 * Where a schema the walk remembers is told: the first place it is reached, in code point order,
 * and every site that reaches it, through the remembered schemas it is reached inside.
 */
export type MemoPlace = { readonly at: Place; readonly sites: Sites };

/** A reach of a memo, which stands nowhere until the memo it was made inside is placed. */
type HeldReach = { readonly memo: Memo; readonly reach: Memo['reaches'][number] };

/**
 * The places of the memos of one walk, settled together once it is over: a first place is known
 * only after the whole walk, since a later Endpoint can reach a def at a smaller place, so the
 * walker cannot hand each memo its place as it closes. The memos given and every memo they are
 * reached inside settle, and a memo's sites are its own and those of every memo it is reached
 * inside.
 */
export function memoPlacesOf(memos: Iterable<Memo>): ReadonlyMap<Memo, MemoPlace> {
  const wanted = new Set(memos);
  const all = closureOf(wanted);
  const inside = heldInsideOf(all);
  const sites = sitesOf(all, inside);
  const placed = new Map<Memo, MemoPlace>();
  for (const [memo, at] of firstPlacesOf(all, inside, wanted)) {
    placed.set(memo, { at, sites: sites.get(memo) ?? new Map() });
  }
  return placed;
}

/**
 * Memos settle in code point order of their first place: the smallest place any unsettled memo
 * is reached at is final, since a place inside a memo only extends that memo's. The places kept
 * are the wanted memos'; the others only settle, so what is kept is theirs alone.
 */
function firstPlacesOf(
  memos: ReadonlySet<Memo>,
  inside: ReadonlyMap<Memo, readonly HeldReach[]>,
  wanted: ReadonlySet<Memo>,
): ReadonlyMap<Memo, Place> {
  const first = new Map<Memo, Place>();
  const frontier = frontierOf(memos);
  for (let next = frontier.pop(); next !== undefined; next = frontier.pop()) {
    if (wanted.has(next.memo)) {
      first.set(next.memo, next.at);
    }
    frontier.offerInside(next, inside.get(next.memo) ?? []);
  }
  return first;
}

/**
 * The best reach of each memo not yet settled, the smallest place first, seeded with the memos'
 * top-level reaches. A memo enters the heap only when a reach improves on its best, so a memo
 * reached many times inside one memo enters once; `pop` settles the memo it returns.
 */
function frontierOf(memos: ReadonlySet<Memo>) {
  const heap: PlacedReach[] = [];
  const best = new Map<Memo, string>();
  const settled = new Set<Memo>();
  const offer = (memo: Memo, at: Place, text: string) => {
    const known = best.get(memo);
    if (known === undefined || byCodePoint(text, known) < 0) {
      best.set(memo, text);
      pushReach(heap, { memo, at, text });
    }
  };
  for (const memo of memos) {
    for (const { at, within } of memo.reaches) {
      if (within === undefined) {
        offer(memo, at, locationTextOf(at));
      }
    }
  }
  return {
    pop: () => {
      for (let next = popReach(heap); next !== undefined; next = popReach(heap)) {
        if (!settled.has(next.memo)) {
          settled.add(next.memo);
          return next;
        }
      }
      return undefined;
    },
    offerInside: (outer: PlacedReach, held: readonly HeldReach[]) => {
      for (const { memo, reach } of held.filter((entry) => !settled.has(entry.memo))) {
        const below = reach.at.steps.slice(outer.memo.at.steps.length);
        offer(
          memo,
          movedFrom(reach.at, outer.memo.at, outer.at),
          locationBelowOf(outer.text, outer.at, below),
        );
      }
    },
  };
}

/** The memos given and every memo one of them is reached inside, at any depth. */
function closureOf(memos: Iterable<Memo>): ReadonlySet<Memo> {
  const seen = new Set<Memo>();
  const pending = [...memos];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    if (!seen.has(next)) {
      seen.add(next);
      for (const { within } of next.reaches) {
        if (within !== undefined) {
          pending.push(within);
        }
      }
    }
  }
  return seen;
}

/** The reaches made inside each memo, of whichever memo. */
function heldInsideOf(memos: ReadonlySet<Memo>): ReadonlyMap<Memo, readonly HeldReach[]> {
  const inside = new Map<Memo, HeldReach[]>();
  for (const memo of memos) {
    for (const reach of memo.reaches) {
      if (reach.within !== undefined) {
        const held = inside.get(reach.within) ?? [];
        held.push({ memo, reach });
        inside.set(reach.within, held);
      }
    }
  }
  return inside;
}

/**
 * The sites of each memo: those of its own top-level reaches, and every site of each memo it is
 * reached inside, each site reaching each memo once.
 */
function sitesOf(
  memos: ReadonlySet<Memo>,
  inside: ReadonlyMap<Memo, readonly HeldReach[]>,
): ReadonlyMap<Memo, Sites> {
  const sites = new Map<Memo, Map<string, Site>>();
  const pending: (readonly [Memo, string, Site])[] = [];
  const add = (memo: Memo, text: string, site: Site) => {
    const known = sites.get(memo) ?? new Map<string, Site>();
    sites.set(memo, known);
    if (!known.has(text)) {
      known.set(text, site);
      pending.push([memo, text, site]);
    }
  };
  for (const memo of memos) {
    for (const { at, within } of memo.reaches) {
      if (within === undefined) {
        add(memo, siteTextOf(at.site), at.site);
      }
    }
  }
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    const [outer, text, site] = next;
    for (const { memo } of inside.get(outer) ?? []) {
      add(memo, text, site);
    }
  }
  return sites;
}

/** The code point order of the places a line would name. */
export function byLocation(left: Place, right: Place): number {
  return byCodePoint(locationTextOf(left), locationTextOf(right));
}

/** The text a line names a place by: its site and the steps under it. */
export function locationTextOf({ site, steps }: Place): string {
  return siteLocationOf(site, steps);
}
