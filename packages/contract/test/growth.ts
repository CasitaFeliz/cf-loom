const runs = 3;

/**
 * How many times longer a shape takes at `large` than at `small`: the fastest of three interleaved
 * runs of each, each on a fresh fixture, so that load slowing both sizes cancels out. `prepare`
 * builds the fixture outside the timed part and returns the call to time.
 */
export function growthOf(
  prepare: (size: number) => () => unknown,
  small: number,
  large: number,
): number {
  let fastestSmall = Number.POSITIVE_INFINITY;
  let fastestLarge = Number.POSITIVE_INFINITY;
  for (let run = 0; run < runs; run++) {
    fastestSmall = Math.min(fastestSmall, millisecondsOf(prepare(small)));
    fastestLarge = Math.min(fastestLarge, millisecondsOf(prepare(large)));
  }
  return fastestLarge / fastestSmall;
}

function millisecondsOf(call: () => unknown): number {
  const started = performance.now();
  call();
  return performance.now() - started;
}
