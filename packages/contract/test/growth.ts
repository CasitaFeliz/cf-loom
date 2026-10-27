const attempts = 3;
const spans = 3;
const spanMilliseconds = 200;

/** The two sizes a shape is timed at. */
export type Sizes = { readonly small: number; readonly large: number };

/**
 * How many times longer a shape takes at `sizes.large` than at `sizes.small`: the smallest of up
 * to three measurements, which stop at the first under `bound`. A measurement is the fastest of
 * three interleaved spans of each size, and a span is one run of the shape on each of as many
 * fresh fixtures as take about 200 ms, timed together by the CPU time of the thread and divided
 * by their number. A busy host stretches the CPU time far less than the clock, since a run waiting
 * for a core counts only the time it ran. The CPU time advances by the tick of the scheduler, 1 to
 * 10 ms, which 200 ms makes a small part of a span, but not of a single run of a small size. A
 * measurement can still be skewed now and then, and only upward, while a quadratic shape measures
 * high every time. `prepare` builds the fixture outside the timed part and returns the call to
 * time.
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
  for (let span = 0; span < spans; span++) {
    fastestSmall = Math.min(fastestSmall, cpuMillisecondsPerRun(prepare, sizes.small));
    fastestLarge = Math.min(fastestLarge, cpuMillisecondsPerRun(prepare, sizes.large));
  }
  return fastestLarge / fastestSmall;
}

function cpuMillisecondsPerRun(prepare: (size: number) => () => unknown, size: number): number {
  const calls = Array.from({ length: runsToFillSpan(prepare, size) }, () => prepare(size));
  const started = process.threadCpuUsage();
  for (const call of calls) {
    call();
  }
  const { user, system } = process.threadCpuUsage(started);
  return (user + system) / 1000 / calls.length;
}

/** One run on a fresh fixture, which also warms the code up, tells how many fill a span. */
function runsToFillSpan(prepare: (size: number) => () => unknown, size: number): number {
  const call = prepare(size);
  const started = performance.now();
  call();
  return Math.ceil(spanMilliseconds / (performance.now() - started));
}
