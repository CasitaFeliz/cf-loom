import {
  byCodePoint,
  type Memo,
  movedFrom,
  type Place,
  type Site,
  sameSite,
  siteLocationOf,
} from '../walker/index.ts';

/**
 * Where each schema the walk remembers is told: from the first place it is reached, in code point
 * order, and with every site that reaches it, through the remembered schemas it is reached inside.
 */
export type MemoPlaces = {
  readonly firstOf: (memo: Memo) => Place;
  readonly sitesOf: (memo: Memo) => readonly Site[];
};

/** The places of the memos of one walk, each settled once and kept. */
export function memoPlaces(): MemoPlaces {
  const first = new Map<Memo, Place>();
  const sites = new Map<Memo, readonly Site[]>();
  return {
    firstOf: (memo) => firstOf(first, memo),
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

/**
 * Memos settle in code point order of their first place: the smallest place any unsettled memo
 * is reached at is final, since a place inside a memo only extends that memo's.
 */
function firstOf(first: Map<Memo, Place>, memo: Memo): Place {
  const settled = first.get(memo);
  if (settled !== undefined) {
    return settled;
  }
  const unsettled = [...around(memo)].filter((other) => !first.has(other));
  const reaches = placedReaches(first, unsettled);
  for (let next = reaches.pop(); next !== undefined; next = reaches.pop()) {
    if (!first.has(next.memo)) {
      first.set(next.memo, next.at);
      reaches.settled(next.memo);
    }
    if (next.memo === memo) {
      return next.at;
    }
  }
  throw new Error('A remembered schema is reached from no place: a bug.');
}

/** A reach of a memo, with the place it stands at and the text a line names that place by. */
type PlacedReach = {
  readonly memo: Memo;
  readonly at: Place;
  readonly text: string;
  readonly sequence: number;
};

/** A reach of a memo, which stands nowhere until the memo it was made inside is settled. */
type HeldReach = { readonly memo: Memo; readonly reach: Memo['reaches'][number] };

/**
 * The reaches of the memos that stand somewhere, the smallest place first: a reach made inside
 * an unsettled memo stands somewhere once `settled` is told that memo is.
 */
function placedReaches(first: ReadonlyMap<Memo, Place>, memos: readonly Memo[]) {
  const heap: PlacedReach[] = [];
  const waiting = new Map<Memo, HeldReach[]>();
  let placed = 0;
  const place = ({ memo, reach }: HeldReach) => {
    const at = placeOf(reach, first);
    if (at !== undefined && !first.has(memo)) {
      pushReach(heap, { memo, at, text: locationTextOf(at), sequence: placed++ });
    }
  };
  for (const memo of memos) {
    for (const reach of memo.reaches) {
      const outer = reach.within;
      if (outer === undefined || first.has(outer)) {
        place({ memo, reach });
      } else {
        waiting.set(outer, [...(waiting.get(outer) ?? []), { memo, reach }]);
      }
    }
  }
  return {
    pop: () => popReach(heap),
    settled: (memo: Memo) => {
      for (const held of waiting.get(memo) ?? []) {
        place(held);
      }
    },
  };
}

/** The place a reach stands at once the memo it was made inside is placed, else none yet. */
function placeOf(
  reach: Memo['reaches'][number],
  first: ReadonlyMap<Memo, Place>,
): Place | undefined {
  if (reach.within === undefined) {
    return reach.at;
  }
  const outer = first.get(reach.within);
  return outer === undefined ? undefined : movedFrom(reach.at, reach.within.at, outer);
}

/** Whether a reach is placed before another: by its text in code point order, else as pushed. */
function isBefore(left: PlacedReach, right: PlacedReach): boolean {
  return (byCodePoint(left.text, right.text) || left.sequence - right.sequence) < 0;
}

/** Whether the reach at one slot comes before the one at another; a missing slot never does. */
function isBeforeAt(heap: readonly PlacedReach[], left: number, right: number): boolean {
  const first = heap[left];
  const second = heap[right];
  return first !== undefined && second !== undefined && isBefore(first, second);
}

function swapAt(heap: PlacedReach[], left: number, right: number): void {
  const first = heap[left];
  const second = heap[right];
  if (first !== undefined && second !== undefined) {
    heap[left] = second;
    heap[right] = first;
  }
}

function pushReach(heap: PlacedReach[], reach: PlacedReach): void {
  heap.push(reach);
  let index = heap.length - 1;
  while (index > 0) {
    const parent = Math.floor((index - 1) / 2);
    if (!isBeforeAt(heap, index, parent)) {
      return;
    }
    swapAt(heap, index, parent);
    index = parent;
  }
}

function popReach(heap: PlacedReach[]): PlacedReach | undefined {
  const smallest = heap[0];
  const last = heap.pop();
  if (smallest !== undefined && last !== undefined && heap.length > 0) {
    heap[0] = last;
    sinkFirst(heap);
  }
  return smallest;
}

function sinkFirst(heap: PlacedReach[]): void {
  let index = 0;
  for (;;) {
    let smallest = index;
    for (const child of [2 * index + 1, 2 * index + 2]) {
      if (isBeforeAt(heap, child, smallest)) {
        smallest = child;
      }
    }
    if (smallest === index) {
      return;
    }
    swapAt(heap, index, smallest);
    index = smallest;
  }
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
