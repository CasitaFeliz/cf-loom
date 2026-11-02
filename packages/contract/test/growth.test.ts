import { describe, expect, test } from 'vitest';
import { growthTimeout } from '../vitest.growth.config.ts';
import { collectedOnce } from './collected.ts';
import { cpuRatioOf, orderOf, orders } from './growth.ts';

const sizes = { small: 2_000, large: 16_000 };

const namesBySize = new Map<number, readonly string[]>();
const setsBySize = new Map<number, ReadonlySet<string>>();

/** `size` distinct names, built once per size so that every fixture of a size shares them. */
function namesOf(size: number): readonly string[] {
  const names = namesBySize.get(size) ?? Array.from({ length: size }, (_, index) => `name${index}`);
  namesBySize.set(size, names);
  return names;
}

/** The names of `size` in a set, built once per size. */
function setOfNamesOf(size: number): ReadonlySet<string> {
  const set = setsBySize.get(size) ?? new Set(namesOf(size));
  setsBySize.set(size, set);
  return set;
}

/** A read of each name once: n steps. */
function readingEachName(size: number) {
  const names = namesOf(size);
  return () => names.map((name) => name.length);
}

/** A scan of every name, for an absent name at one name in `every`: n²/every comparisons. */
function scanningAtEvery(every: number) {
  return (size: number) => {
    const names = namesOf(size);
    return () => {
      let found = 0;
      for (let index = 0; index < size; index += every) {
        found += names.includes(`absent${index}`) ? 1 : 0;
      }
      return found;
    };
  };
}

/** A thousand lookups in a set of the names: the same steps at every size. */
function lookingUpThousandNames(size: number) {
  const names = setOfNamesOf(size);
  return () => {
    let found = 0;
    for (let index = 0; index < 1_000; index++) {
      found += names.has(`name${index}`) ? 1 : 0;
    }
    return found;
  };
}

/** A scan of the names for each of them, absent, over a fortieth of the size: n²/1,600 comparisons, a run under a tick of the CPU clock. */
function scanningFortiethOfNames(size: number) {
  const names = namesOf(size / 40);
  return () => {
    let found = 0;
    for (const name of names) {
      found += names.includes(`absent${name}`) ? 1 : 0;
    }
    return found;
  };
}

/**
 * `prepare`, whose first `times` runs at `waitingSize` each wait a quarter of a second for a core,
 * as a preempted run does: they take wall time and no CPU time.
 */
function waitingAtFirst(
  prepare: (size: number) => () => unknown,
  waitingSize: number,
  times: number,
) {
  let waits = 0;
  return (size: number) => {
    const call = prepare(size);
    return () => {
      if (size === waitingSize && waits < times) {
        waits++;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
      }
      return call();
    };
  };
}

/** A walk of every subset of `size` items, counting the members of each: n times 2 to the n steps. */
function walkingEverySubset(size: number) {
  return () => {
    let members = 0;
    for (let subset = 0; subset < 2 ** size; subset++) {
      for (let item = 0; item < size; item++) {
        members += Math.floor(subset / 2 ** item) % 2;
      }
    }
    return members;
  };
}

const fixtureDoubles = 8_192;
const fixtureBytes = fixtureDoubles * Float64Array.BYTES_PER_ELEMENT;

/** One try of `orderOf`: the heap in use when it began, after a full collection, and the fixtures it built. */
type Try = { readonly heapUsedAtStart: number; fixtures: number };

/**
 * Fixtures of 8,192 doubles on the heap, 64 KB each, whose run reads them for about `size`
 * milliseconds, and the tries they were built for: a build after a run begins a try.
 */
function fixturesOfTries() {
  const tries: Try[] = [];
  let current: Try = { heapUsedAtStart: 0, fixtures: 0 };
  let ranSinceBuild = true;
  const prepare = (size: number) => {
    if (ranSinceBuild) {
      ranSinceBuild = false;
      collectedOnce();
      current = { heapUsedAtStart: process.memoryUsage().heapUsed, fixtures: 0 };
      tries.push(current);
    }
    current.fixtures++;
    const fixture = Array.from({ length: fixtureDoubles }, (_, index) => index + 0.5);
    return () => {
      ranSinceBuild = true;
      let sum = 0;
      for (let pass = 0; pass < size * 122; pass++) {
        for (const value of fixture) {
          sum += value;
        }
      }
      return sum;
    };
  };
  return { prepare, tries };
}

const heapReadEvery = 16_384;

/** The bytes an array holds for each reference it lists. */
const slotBytes = Float64Array.BYTES_PER_ELEMENT;

/**
 * A step of 512 additions, which takes tens of nanoseconds, as a call, with the most heap in use
 * that one of its runs saw, read once in every 16,384 runs.
 */
function stepSeeingTheHeap() {
  const seen = { runs: 0, mostHeapUsed: 0 };
  const call = () => {
    seen.runs++;
    if (seen.runs % heapReadEvery === 0) {
      seen.mostHeapUsed = Math.max(seen.mostHeapUsed, process.memoryUsage().heapUsed);
    }
    return additionsOfTheStep();
  };
  return { call, seen };
}

/** The 512 additions of the step, as a call that reads no heap. */
function additionsOfTheStep() {
  let sum = 0;
  for (let index = 0; index < 512; index++) {
    sum += index;
  }
  return sum;
}

describe('orderOf', () => {
  test('a read of each name once is under the linear order', { timeout: growthTimeout }, () => {
    const order = orderOf(readingEachName, sizes, orders.linear);

    expect(order).toBeLessThan(orders.linear);
  });

  test('a read of each name once reaches the flat order', { timeout: growthTimeout }, () => {
    const order = orderOf(readingEachName, sizes, orders.flat);

    expect(order).toBeGreaterThanOrEqual(orders.flat);
  });

  test('a quadratic scan of a fortieth of the names, whose first runs at the large size wait for a core, reaches the linear order', {
    timeout: growthTimeout,
  }, () => {
    const waiting = waitingAtFirst(scanningFortiethOfNames, sizes.large, 3);

    const order = orderOf(waiting, sizes, orders.linear);

    expect(order).toBeGreaterThanOrEqual(orders.linear);
  });

  test('a read of each name once, whose first runs at the large size wait for a core, reaches the flat order', {
    timeout: growthTimeout,
  }, () => {
    const waiting = waitingAtFirst(readingEachName, sizes.large, 3);

    const order = orderOf(waiting, sizes, orders.flat);

    expect(order).toBeGreaterThanOrEqual(orders.flat);
  });

  test('a read of each name once, whose first 18 runs at the small size wait for a core, reaches the flat order', {
    timeout: growthTimeout,
  }, () => {
    const waiting = waitingAtFirst(readingEachName, sizes.small, 18);

    const order = orderOf(waiting, sizes, orders.flat);

    expect(order).toBeGreaterThanOrEqual(orders.flat);
  });

  test.each([1, 8])(
    'a scan of the names at one name in %i reaches the linear order',
    (every) => {
      const order = orderOf(scanningAtEvery(every), sizes, orders.linear);

      expect(order).toBeGreaterThanOrEqual(orders.linear);
    },
    growthTimeout,
  );

  test('a thousand lookups in a set of the names are under the flat order', {
    timeout: growthTimeout,
  }, () => {
    const order = orderOf(lookingUpThousandNames, sizes, orders.flat);

    expect(order).toBeLessThan(orders.flat);
  });

  test('a walk of every subset reaches the polynomial order at twice the size', {
    timeout: growthTimeout,
  }, () => {
    const order = orderOf(walkingEverySubset, { small: 8, large: 16 }, orders.polynomial);

    expect(order).toBeGreaterThanOrEqual(orders.polynomial);
  });

  test("a try holds none of an earlier try's fixtures", { timeout: growthTimeout }, () => {
    const { prepare, tries } = fixturesOfTries();

    orderOf(prepare, { small: 1, large: 8 }, orders.linear);

    const heapAtStarts = tries.map(({ heapUsedAtStart }) => heapUsedAtStart);
    const heldByLaterTries = Math.max(...heapAtStarts) - Math.min(...heapAtStarts);
    const largestTryBytes = Math.max(...tries.map(({ fixtures }) => fixtures)) * fixtureBytes;
    expect(heldByLaterTries).toBeLessThan(largestTryBytes / 2);
  });

  test("a bound of a test's own is refused", () => {
    const reading = (size: number) => () => size;

    // @ts-expect-error TS2345 a growth test asserts one of the orders, never a bound of its own
    const refused = () => orderOf(reading, sizes, 13);

    expect(refused).toBeTypeOf('function');
  });
});

describe('cpuRatioOf', () => {
  test('a read of 16,000 names takes at least twice the CPU time of a read of 2,000', {
    timeout: growthTimeout,
  }, () => {
    const large = readingEachName(16_000);
    const small = readingEachName(2_000);

    const ratio = cpuRatioOf(large, small, 2);

    expect(ratio).toBeGreaterThanOrEqual(2);
  });

  test('a call of tens of nanoseconds holds no memory for each of its runs', {
    timeout: growthTimeout,
  }, () => {
    const { call, seen } = stepSeeingTheHeap();
    collectedOnce();
    const heapUsedBefore = process.memoryUsage().heapUsed;

    cpuRatioOf(call, additionsOfTheStep, 2);

    const heldForEachRun = (seen.mostHeapUsed - heapUsedBefore) / seen.runs;
    expect(heldForEachRun).toBeLessThan(slotBytes / 2);
  });
});
