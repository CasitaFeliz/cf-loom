import { describe, expect, test } from 'vitest';
import { growthTimeout } from '../vitest.growth.config.ts';
import { orderOf, orders } from './growth.ts';

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

describe('orderOf', () => {
  test('a read of each name once is under the linear order', { timeout: growthTimeout }, () => {
    const order = orderOf(readingEachName, sizes, orders.linear);

    expect(order).toBeLessThan(orders.linear);
  });

  test('a read of each name once reaches the flat order', { timeout: growthTimeout }, () => {
    const order = orderOf(readingEachName, sizes, orders.flat);

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

  test("a bound of a test's own is refused", () => {
    const reading = (size: number) => () => size;

    // @ts-expect-error TS2345 a growth test asserts one of the orders, never a bound of its own
    const refused = () => orderOf(reading, sizes, 13);

    expect(refused).toBeTypeOf('function');
  });
});
