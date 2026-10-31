import {
  belowTextOf,
  byCodePoint,
  type Memo,
  movedFrom,
  type NotAllowed,
  type Place,
  siteLocationOf,
  stepListOf,
} from '../walker/index.ts';

/** A reach of a memo, which stands nowhere until the memo it was made inside is placed. */
export type HeldReach = { readonly memo: Memo; readonly reach: Memo['reaches'][number] };

/**
 * Where a refusal is told, and its rank among the places told, in code point order; refusals told
 * at one place share a rank.
 */
export type ToldPlace = { readonly at: Place; readonly rank: number };

/** A reach of a memo, or a refusal to tell. */
type Pending =
  | { readonly kind: 'reach'; readonly memo: Memo }
  | { readonly kind: 'telling'; readonly refusal: NotAllowed };

/** A reach or a refusal that stands at a place of its own, outside every memo the walk settles. */
export type Standing = Pending & { readonly at: Place };

/**
 * Something pending at the place it would stand at, and that place's text left below a node, from
 * `offset`, which moves down the text as the walk does, since a node holds it alone.
 */
type Waiting = Standing & { readonly text: string; offset: number };

type Telling = Waiting & { readonly kind: 'telling' };

type Reaching = Waiting & { readonly kind: 'reach' };

/** What the walk of the trie reads: the reaches and refusals held inside each memo. */
export type Holdings = {
  readonly reaches: ReadonlyMap<Memo, readonly HeldReach[]>;
  readonly refusals: ReadonlyMap<Memo, readonly NotAllowed[]>;
};

/**
 * Settles the memos and ranks the refusals in code point order of their places, in one walk of
 * the trie of the texts of those places. A place inside a memo only extends that memo's, so the
 * walk reads a place's own steps once and never the text of the place it extends.
 */
export function toldPlacesOf(
  roots: readonly Standing[],
  holdings: Holdings,
): ReadonlyMap<NotAllowed, ToldPlace> {
  const told = new Map<NotAllowed, ToldPlace>();
  const settled = new Set<Memo>();
  const start = roots.map((root) => ({ ...root, text: locationTextOf(root.at), offset: 0 }));
  const nodes: (readonly Waiting[])[] = [start];
  let rank = 0;
  for (let node = nodes.pop(); node !== undefined; node = nodes.pop()) {
    const { ended, below } = visitNode(node, settled, holdings);
    for (const telling of ended) {
      told.set(telling.refusal, { at: telling.at, rank });
    }
    rank += ended.length > 0 ? 1 : 0;
    for (const child of childrenOf(below)) {
      nodes.push(child);
    }
  }
  return told;
}

/**
 * What waits at a node, taken in the order it arrived, so of two reaches of one text the first
 * offered settles the memo: the refusals that end here, and what goes on below.
 */
function visitNode(
  node: readonly Waiting[],
  settled: Set<Memo>,
  holdings: Holdings,
): { readonly ended: readonly Telling[]; readonly below: readonly Waiting[] } {
  const queue = [...node];
  const ended: Telling[] = [];
  const below: Waiting[] = [];
  for (let index = 0, next = queue[0]; next !== undefined; index++, next = queue[index]) {
    if (next.kind === 'reach' && settled.has(next.memo)) {
      continue;
    }
    if (next.offset < next.text.length) {
      below.push(next);
    } else if (next.kind === 'telling') {
      ended.push(next);
    } else {
      settled.add(next.memo);
      for (const offered of offersOf(next, holdings)) {
        queue.push(offered);
      }
    }
  }
  return { ended, below };
}

/** What a memo just settled holds, each waiting below the node it settled at. */
function offersOf(settledAt: Reaching, holdings: Holdings): readonly Waiting[] {
  const { memo } = settledAt;
  const below = (at: Place) => ({
    at: movedFrom(at, memo.at, settledAt.at),
    text: belowTextOf(settledAt.at, at.steps, memo.at.steps),
    offset: 0,
  });
  const reaches = (holdings.reaches.get(memo) ?? []).map(({ memo: held, reach }) => ({
    kind: 'reach' as const,
    memo: held,
    ...below(reach.at),
  }));
  const refusals = (holdings.refusals.get(memo) ?? []).map((refusal) => ({
    kind: 'telling' as const,
    refusal,
    ...below(refusal),
  }));
  return [...reaches, ...refusals];
}

/** The children of a node, the greatest code point first so the walk pops the smallest. */
function childrenOf(below: readonly Waiting[]): readonly (readonly Waiting[])[] {
  const byPoint = new Map<string, Waiting[]>();
  for (const waiting of below) {
    const point = String.fromCodePoint(waiting.text.codePointAt(waiting.offset) ?? 0);
    const group = byPoint.get(point) ?? [];
    waiting.offset += point.length;
    group.push(waiting);
    byPoint.set(point, group);
  }
  return [...byPoint.keys()]
    .sort((left, right) => byCodePoint(right, left))
    .map((point) => byPoint.get(point) ?? []);
}

/** The text a line names a place by: its site and the steps under it. */
function locationTextOf({ site, steps }: Place): string {
  return siteLocationOf(site, stepListOf(steps));
}
