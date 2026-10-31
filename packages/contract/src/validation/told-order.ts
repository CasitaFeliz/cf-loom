import {
  belowTextOf,
  byCodePoint,
  type Memo,
  movedFrom,
  type NotAllowed,
  type Place,
} from '../walker/index.ts';

/** A reach of a memo, which stands nowhere until the memo it was made inside is placed. */
export type HeldReach = { readonly memo: Memo; readonly reach: Memo['reaches'][number] };

/**
 * Where a refusal is told, and its rank among the places told, in code point order; refusals told
 * at one place share a rank.
 */
export type ToldPlace = { readonly at: Place; readonly rank: number };

/** What waits in the trie of place texts: a reach of a memo, or a refusal to tell. */
type Held =
  | { readonly kind: 'reach'; readonly memo: Memo }
  | { readonly kind: 'telling'; readonly refusal: NotAllowed };

/** A held thing at the place it would stand at, and that place's text left below a node, from `offset`. */
export type Waiting = Held & { readonly at: Place; readonly text: string; readonly offset: number };

type Telling = Waiting & { readonly kind: 'telling' };

/** What the walk of the trie reads: the reaches and refusals held inside each memo. */
export type Holdings = {
  readonly reaches: ReadonlyMap<Memo, readonly HeldReach[]>;
  readonly refusals: ReadonlyMap<Memo, readonly NotAllowed[]>;
};

/**
 * Memos settle and refusals are told in code point order of their places, read as one walk of
 * the trie of place texts in that order: a place inside a memo only extends that memo's first
 * place, so all a memo settled at a node holds waits below that node, which the walk has not
 * passed. Each character of a place's own steps is read once, never the text of the place it
 * extends, so the time grows with the places and their own steps, never with how deep they are.
 * What waits at a node is taken in the order it arrived, so of two reaches of one text the first
 * offered settles the memo.
 */
export function toldPlacesOf(
  roots: readonly Waiting[],
  holdings: Holdings,
): ReadonlyMap<NotAllowed, ToldPlace> {
  const told = new Map<NotAllowed, ToldPlace>();
  const settled = new Set<Memo>();
  const nodes: (readonly Waiting[])[] = [roots];
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

/** What waits at a node, in arrival order: the refusals that end here, and what goes on below, once the memos that end here settle. */
function visitNode(
  node: readonly Waiting[],
  settled: Set<Memo>,
  holdings: Holdings,
): { readonly ended: readonly Telling[]; readonly below: readonly Waiting[] } {
  const queue = [...node];
  const ended: Telling[] = [];
  const below: Waiting[] = [];
  for (let at = 0, next = queue[0]; next !== undefined; at++, next = queue[at]) {
    if (next.kind === 'reach' && settled.has(next.memo)) {
      continue;
    }
    if (next.offset < next.text.length) {
      below.push(next);
    } else if (next.kind === 'telling') {
      ended.push(next);
    } else {
      settled.add(next.memo);
      for (const offered of offersOf(next, next.memo, holdings)) {
        queue.push(offered);
      }
    }
  }
  return { ended, below };
}

/** What a memo just settled holds, each waiting below the node it settled at. */
function offersOf(settledAt: Waiting, memo: Memo, holdings: Holdings): readonly Waiting[] {
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

/**
 * The children of a node, the greatest code point first so the walk pops the smallest: one
 * thing alone below a node meets no other there, so it moves straight to the end of its text.
 */
function childrenOf(below: readonly Waiting[]): readonly (readonly Waiting[])[] {
  const [only] = below;
  if (below.length === 1 && only !== undefined) {
    return [[{ ...only, offset: only.text.length }]];
  }
  const byPoint = new Map<string, Waiting[]>();
  for (const waiting of below) {
    const point = String.fromCodePoint(waiting.text.codePointAt(waiting.offset) ?? 0);
    const group = byPoint.get(point) ?? [];
    group.push({ ...waiting, offset: waiting.offset + point.length });
    byPoint.set(point, group);
  }
  return [...byPoint.keys()]
    .sort((left, right) => byCodePoint(right, left))
    .map((point) => byPoint.get(point) ?? []);
}
