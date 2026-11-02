const attempts = 3;
const spans = 3;
const spanMilliseconds = 200;

/** The two sizes a shape is timed at. */
export type Sizes = { readonly small: number; readonly large: number };

/**
 * The orders a growth test holds a shape under. Flat and linear sit halfway, in powers of the size,
 * between the order they claim and the next, a factor of √r on each side at r times the size;
 * a flat or linear claim is measured at eight times the size or more, where that factor is √8 =
 * 2.83. A step costs more at the large size once the fixture spills out of the caches, and more
 * again beside neighbours that share the memory, up to about 2.6 times at eight times the size on
 * the busiest reading measured, which √8 still holds; a part that grows with the next power is
 * caught once it is about a quarter of the run at the small size. Polynomial, for a shape that
 * must not grow exponentially, sits at 3, which an exponential shape exceeds many times over at
 * twice the size.
 */
export const orders = { flat: 0.5, linear: 1.5, polynomial: 3 } as const;

/** One of `orders`: a growth test holds a shape under one of them, never under a bound of its own. */
export type Order = (typeof orders)[keyof typeof orders];

/**
 * The order of a shape's growth between `sizes.small` and `sizes.large`: the power of the size its
 * CPU time grows by, so about 1 for a linear shape and 2 for a quadratic one. The smallest of up to
 * three measurements, which stop at the first under `below`. A measurement is the fastest of three
 * interleaved spans of each size, and a span is one run of the shape on each of as many fresh
 * fixtures as fill 200 ms of the thread's CPU time, timed together and divided by their number. The
 * CPU time leaves out the time a run waits for a core, but not the time it waits for memory, which
 * `orders` holds. It advances by the tick of the scheduler, 1 to 10 ms, so a run shorter than a tick
 * reads as nothing or as a whole tick: runs that read under 200 ms together are no span, and the
 * next try is sized from what they read, at most twice as many. A measurement is a ratio, so a slow
 * span on either side skews it, but only three slow spans of one side in one measurement move it,
 * while a shape of a higher order measures high every time.
 * A fresh fixture does two jobs: no run reads what an earlier one read, so no memo answers for the
 * code timed, and both sizes read about as much memory in a span. A fixture that costs more to build
 * than a run is built once per size and copied for each run. A span holds the fixtures of its 200 ms
 * of runs at once, and only its own, so a fast run on a large fixture holds many of them. It holds
 * each run's call too, until the span is timed, so a run of tens of nanoseconds outgrows a test's
 * heap, and should repeat its step inside the call, as `lookingUpThousandNames` in growth.test.ts
 * does. `prepare` builds the fixture outside the timed part and returns the call to time.
 */
export function orderOf(
  prepare: (size: number) => () => unknown,
  sizes: Sizes,
  below: Order,
): number {
  const smallTimer = spanTimerOf((runs) =>
    cpuMillisecondsOfFresh(() => prepare(sizes.small), runs),
  );
  const largeTimer = spanTimerOf((runs) =>
    cpuMillisecondsOfFresh(() => prepare(sizes.large), runs),
  );
  const growth = smallestRatioOf(largeTimer, smallTimer, (sizes.large / sizes.small) ** below);
  return orderOfGrowth(growth, sizes);
}

/** The order a growth between `sizes.small` and `sizes.large` is: the power of their ratio it equals. */
export function orderOfGrowth(growth: number, sizes: Sizes): number {
  return Math.log(growth) / Math.log(sizes.large / sizes.small);
}

/**
 * How many times longer a run of `call` takes than a run of `reference`, in CPU time of the thread:
 * the smallest of up to three measurements, which stop at the first under `bound`, each taken as
 * `orderOf` takes it. A span is as many runs as fill 200 ms, so a run shorter than a tick still
 * measures. A slower host stretches the ratio far less than it stretches either run, so it holds
 * where an absolute bound does not.
 */
export function cpuRatioOf(call: () => unknown, reference: () => unknown, bound: number): number {
  const callTimer = spanTimerOf((runs) => cpuMillisecondsOfRepeated(call, runs));
  const referenceTimer = spanTimerOf((runs) => cpuMillisecondsOfRepeated(reference, runs));
  return smallestRatioOf(callTimer, referenceTimer, bound);
}

/**
 * The smallest of up to three measurements of how many times longer a run timed by `timer` takes
 * than one timed by `reference`, which stop at the first under `bound`. A measurement is the fastest
 * of three interleaved spans of each, so a cold or interrupted span on either side is discarded
 * before the early stop looks at the ratio.
 */
function smallestRatioOf(timer: () => number, reference: () => number, bound: number): number {
  let smallest = Number.POSITIVE_INFINITY;
  for (let attempt = 0; attempt < attempts && smallest >= bound; attempt++) {
    smallest = Math.min(smallest, measuredRatio(timer, reference));
  }
  return smallest;
}

/** A span's runs and the CPU time of the thread each took, in milliseconds. */
type Span = { readonly runs: number; readonly cpuMillisecondsPerRun: number };

/**
 * A timer of spans, each timed by `timed`, that returns a run's CPU time in milliseconds and starts
 * each span from the runs the last one needed, so only the first span pays for the tries that size it.
 */
function spanTimerOf(timed: (runs: number) => number): () => number {
  let runs = 1;
  return () => {
    const span = spanOf(timed, runs);
    runs = span.runs;
    return span.cpuMillisecondsPerRun;
  };
}

function measuredRatio(timer: () => number, reference: () => number): number {
  let fastest = Number.POSITIVE_INFINITY;
  let fastestReference = Number.POSITIVE_INFINITY;
  for (let span = 0; span < spans; span++) {
    fastestReference = Math.min(fastestReference, reference());
    fastest = Math.min(fastest, timer());
  }
  return fastest / fastestReference;
}

/**
 * Runs, from `runs`, timed by `timed` until their CPU time together fills a span: runs that read
 * under it size the next try from what they read, at most twice as many.
 */
function spanOf(timed: (runs: number) => number, runs: number): Span {
  for (let count = runs; ; ) {
    const read = timed(count);
    if (read >= spanMilliseconds) {
      return { runs: count, cpuMillisecondsPerRun: read / count };
    }
    count = Math.min(2 * count, Math.ceil((count * spanMilliseconds) / read));
  }
}

/**
 * The CPU time of the thread that one run on each of `count` fresh fixtures takes, timed together.
 * The fixtures are built here and live only until it returns, so a try never holds an earlier one's.
 */
function cpuMillisecondsOfFresh(fresh: () => () => unknown, count: number): number {
  const calls = Array.from({ length: count }, fresh);
  return cpuMillisecondsOf(() => {
    for (const call of calls) {
      call();
    }
  });
}

/** The CPU time of the thread that `count` runs of one `call` take, which holds nothing for a run. */
function cpuMillisecondsOfRepeated(call: () => unknown, count: number): number {
  return cpuMillisecondsOf(() => {
    for (let run = 0; run < count; run++) {
      call();
    }
  });
}

function cpuMillisecondsOf(runs: () => void): number {
  const started = process.threadCpuUsage();
  runs();
  const { user, system } = process.threadCpuUsage(started);
  return (user + system) / 1000;
}
