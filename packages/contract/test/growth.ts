const attempts = 3;
const runs = 3;

/** The two sizes a shape is timed at. */
export type Sizes = { readonly small: number; readonly large: number };

/**
 * How many times longer a shape takes at `sizes.large` than at `sizes.small`: the smallest of up
 * to three measurements, which stop at the first under `bound`. A measurement is the fastest of
 * three interleaved runs of each size, each on a fresh fixture, so that load slowing both sizes
 * cancels out. Load that hits one size more than the other still skews a measurement now and
 * then, and only upward, while a quadratic shape measures high every time. `prepare` builds the
 * fixture outside the timed part and returns the call to time.
 */
export function growthOf(
  prepare: (size: number) => () => unknown,
  sizes: Sizes,
  bound: number,
): number {
  let smallest = Number.POSITIVE_INFINITY;
  for (let attempt = 0; attempt < attempts && smallest >= bound; attempt++) {
    smallest = Math.min(smallest, measuredGrowth(prepare, sizes));
  }
  return smallest;
}

function measuredGrowth(prepare: (size: number) => () => unknown, sizes: Sizes): number {
  let fastestSmall = Number.POSITIVE_INFINITY;
  let fastestLarge = Number.POSITIVE_INFINITY;
  for (let run = 0; run < runs; run++) {
    fastestSmall = Math.min(fastestSmall, millisecondsOf(prepare(sizes.small)));
    fastestLarge = Math.min(fastestLarge, millisecondsOf(prepare(sizes.large)));
  }
  return fastestLarge / fastestSmall;
}

function millisecondsOf(call: () => unknown): number {
  const started = performance.now();
  call();
  return performance.now() - started;
}
