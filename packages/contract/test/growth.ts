const attempts = 3;
const spans = 3;
const spanMilliseconds = 200;

/** The two sizes a shape is timed at. */
export type Sizes = { readonly small: number; readonly large: number };

/**
 * The orders a growth test holds a shape under. Flat (0.5) and linear (1.5) sit halfway, in powers
 * of the size, between the order they claim and the next, a factor of √8 on each side at eight
 * times the size; a flat or linear claim is measured at eight times the size or more. A step costs
 * more at the large size once the fixture spills out of the caches, and more again beside
 * neighbours that share the memory, up to about 2.6 times at eight times the size on the busiest
 * reading measured, which √8 = 2.83 still holds; a part that grows with the next power is caught
 * once it is about a quarter of the run at the small size. Polynomial (3), for a shape that must
 * not grow exponentially, sits where an exponential shape exceeds it many times over at twice the
 * size.
 */
export const orders = { flat: 0.5, linear: 1.5, polynomial: 3 } as const;

/** One of `orders`: a growth test holds a shape under one of them, never under a bound of its own. */
export type Order = (typeof orders)[keyof typeof orders];

/**
 * The order of a shape's growth between `sizes.small` and `sizes.large`: the power of the size its
 * CPU time grows by, so about 1 for a linear shape and 2 for a quadratic one. The smallest of up to
 * three measurements, which stop at the first under `below`. A measurement is the fastest of three
 * interleaved spans of each size, and a span is one run of the shape on each of as many fresh
 * fixtures as take about 200 ms, timed together by the CPU time of the thread and divided by their
 * number. The CPU time leaves out the time a run waits for a core, but not the time it waits for
 * memory, which `orders` holds. It advances by the tick of the scheduler, 1 to 10 ms, which 200 ms
 * makes a small part of a span, but not of a single run of a small size. A measurement can still be
 * skewed now and then, and only upward, while a shape of a higher order measures high every time.
 * `prepare` builds the fixture outside the timed part and returns the call to time.
 */
export function orderOf(
  prepare: (size: number) => () => unknown,
  sizes: Sizes,
  below: Order,
): number {
  let smallest = Number.POSITIVE_INFINITY;
  for (let attempt = 0; attempt < attempts && smallest >= below; attempt++) {
    smallest = Math.min(smallest, orderOfGrowth(measuredGrowth(prepare, sizes), sizes));
  }
  return smallest;
}

/** The order a growth between `sizes.small` and `sizes.large` is: the power of their ratio it equals. */
export function orderOfGrowth(growth: number, sizes: Sizes): number {
  return Math.log(growth) / Math.log(sizes.large / sizes.small);
}

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

/**
 * How many times longer `call` takes than `reference`, in CPU time of the thread: the fastest run of
 * each over up to three interleaved runs of both, which stop at the first ratio under `bound`. A
 * slower host stretches the ratio far less than it stretches either run, so it holds where an
 * absolute bound does not.
 */
export function cpuRatioOf(call: () => unknown, reference: () => unknown, bound: number): number {
  let fastestCall = Number.POSITIVE_INFINITY;
  let fastestReference = Number.POSITIVE_INFINITY;
  let ratio = Number.POSITIVE_INFINITY;
  for (let attempt = 0; attempt < attempts && ratio >= bound; attempt++) {
    fastestReference = Math.min(fastestReference, cpuMillisecondsOfRun(reference));
    fastestCall = Math.min(fastestCall, cpuMillisecondsOfRun(call));
    ratio = fastestCall / fastestReference;
  }
  return ratio;
}

function cpuMillisecondsOfRun(call: () => unknown): number {
  const started = process.threadCpuUsage();
  call();
  const { user, system } = process.threadCpuUsage(started);
  return (user + system) / 1000;
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
