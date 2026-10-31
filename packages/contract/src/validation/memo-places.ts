import {
  isUnnamedCycle,
  type Memo,
  type NotAllowed,
  type Place,
  type Site,
  siteLocationOf,
  siteTextOf,
  stepListOf,
} from '../walker/index.ts';
import { type HeldReach, type ToldPlace, toldPlacesOf, type Waiting } from './told-order.ts';

/** Every site of a set once, keyed by the text a line names it by. */
type Sites = ReadonlyMap<string, Site>;

/** Where a refusal is told, its rank among the places told, and every site that reaches it. */
export type ToldAt = ToldPlace & { readonly sites: Sites };

/**
 * Where each refusal is told, settled together once the walk is over: a first place is known
 * only after the whole walk, since a later Endpoint can reach a def at a smaller place, so the
 * walker cannot hand each memo its place as it closes. A refusal inside a memo is told from the
 * memo's first place, with every site of that memo, its own and those of every memo it is
 * reached inside; any other refusal at its own place, with its own site.
 */
export function toldAtOf(
  refusals: readonly NotAllowed[],
  memoOf: ReadonlyMap<NotAllowed, Memo>,
): ReadonlyMap<NotAllowed, ToldAt> {
  const memoToldFrom = (refusal: NotAllowed) =>
    isUnnamedCycle(refusal) ? undefined : memoOf.get(refusal);
  const inMemo = groupedByMemo(refusals, memoToldFrom);
  const own = refusals.filter((refusal) => memoToldFrom(refusal) === undefined);
  const all = closureOf(inMemo.keys());
  const reaches = heldInsideOf(all);
  const sites = sitesOf(all, reaches);
  const roots = [...own.map(waitingAtOwnPlace), ...topLevelReachesOf(all)];
  const told = new Map<NotAllowed, ToldAt>();
  for (const [refusal, place] of toldPlacesOf(roots, { reaches, refusals: inMemo })) {
    const memo = memoToldFrom(refusal);
    const memoSites = memo === undefined ? undefined : sites.get(memo);
    const ownSite = new Map([[siteTextOf(refusal.site), refusal.site]]);
    told.set(refusal, { ...place, sites: memoSites ?? ownSite });
  }
  return told;
}

/** The refusals raised inside each memo, in the order given. */
function groupedByMemo(
  refusals: readonly NotAllowed[],
  memoToldFrom: (refusal: NotAllowed) => Memo | undefined,
): ReadonlyMap<Memo, readonly NotAllowed[]> {
  const inMemo = new Map<Memo, NotAllowed[]>();
  for (const refusal of refusals) {
    const memo = memoToldFrom(refusal);
    if (memo !== undefined) {
      const held = inMemo.get(memo) ?? [];
      held.push(refusal);
      inMemo.set(memo, held);
    }
  }
  return inMemo;
}

/** A refusal told at its own place, waiting at the text of that place. */
function waitingAtOwnPlace(refusal: NotAllowed): Waiting {
  return { kind: 'telling', refusal, at: refusal, text: locationTextOf(refusal), offset: 0 };
}

/** The reaches of the memos made from a declaration itself, each waiting at the text of its place. */
function topLevelReachesOf(memos: ReadonlySet<Memo>): readonly Waiting[] {
  const reaches: Waiting[] = [];
  for (const memo of memos) {
    for (const { at, within } of memo.reaches) {
      if (within === undefined) {
        reaches.push({ kind: 'reach', memo, at, text: locationTextOf(at), offset: 0 });
      }
    }
  }
  return reaches;
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

/** The text a line names a place by: its site and the steps under it. */
export function locationTextOf({ site, steps }: Place): string {
  return siteLocationOf(site, stepListOf(steps));
}
