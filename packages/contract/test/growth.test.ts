import { describe, expect, test } from 'vitest';
import { orderOf, orders } from './growth.ts';

const sizes = { small: 2_000, large: 16_000 };

const growthTimeout = 240_000;

/** `size` distinct names, built once per size so every fixture of a size shares them. */
const namesBySize = new Map(
  [sizes.small, sizes.large].map((size) => [
    size,
    Array.from({ length: size }, (_, index) => `name${index}`),
  ]),
);

function namesOf(size: number): readonly string[] {
  return namesBySize.get(size) ?? [];
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

describe('orderOf', () => {
  test('a read of each name once is under the linear order', { timeout: growthTimeout }, () => {
    const reading = (size: number) => {
      const names = namesOf(size);
      return () => names.map((name) => name.length);
    };

    const order = orderOf(reading, sizes, orders.linear);

    expect(order).toBeLessThan(orders.linear);
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
    const sets = new Map([sizes.small, sizes.large].map((size) => [size, new Set(namesOf(size))]));
    const lookingUp = (size: number) => {
      const names = sets.get(size) ?? new Set();
      return () => {
        let found = 0;
        for (let index = 0; index < 1_000; index++) {
          found += names.has(`name${index}`) ? 1 : 0;
        }
        return found;
      };
    };

    const order = orderOf(lookingUp, sizes, orders.flat);

    expect(order).toBeLessThan(orders.flat);
  });

  test("a bound of a test's own is refused", () => {
    const reading = (size: number) => () => size;

    // @ts-expect-error TS2345 a growth test asserts one of the orders, never a bound of its own
    const refused = () => orderOf(reading, sizes, 13);

    expect(refused).toBeTypeOf('function');
  });
});
