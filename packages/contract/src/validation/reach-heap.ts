import { byCodePoint, type Memo, type Place } from '../walker/index.ts';

/** A reach of a memo, with the place it stands at and the text a line names that place by. */
export type PlacedReach = {
  readonly memo: Memo;
  readonly at: Place;
  readonly text: string;
  readonly sequence: number;
};

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

/** Adds a reach to a binary min-heap of reaches, which `popReach` takes the smallest place first from. */
export function pushReach(heap: PlacedReach[], reach: PlacedReach): void {
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

/** Takes the reach with the smallest place off the heap, the one pushed first among equal places. */
export function popReach(heap: PlacedReach[]): PlacedReach | undefined {
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
