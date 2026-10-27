const attempts = 3;
const runs = 3;

/** The two sizes a shape is timed at. */
export type Sizes = { readonly small: number; readonly large: number };

/**
 * How many times longer a shape takes at `sizes.large` than at `sizes.small`: the smallest of up
 * to three measurements, which stop at the first under `bound`. A measurement is the fastest of
 * three interleaved runs of each size, each on a fresh fixture, timed by the CPU time of the
 * thread: a busy host stretches that far less than the clock, since a run waiting for a core
 * counts only the time it ran. A measurement can still be skewed now and then, and only upward,
 * while a quadratic shape measures high every time. `prepare` builds the fixture outside the
 * timed part and returns the call to time.
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
    fastestSmall = Math.min(fastestSmall, cpuMillisecondsOf(prepare(sizes.small)));
    fastestLarge = Math.min(fastestLarge, cpuMillisecondsOf(prepare(sizes.large)));
  }
  return fastestLarge / fastestSmall;
}

function cpuMillisecondsOf(call: () => unknown): number {
  const started = process.threadCpuUsage();
  call();
  const { user, system } = process.threadCpuUsage(started);
  return (user + system) / 1000;
}
