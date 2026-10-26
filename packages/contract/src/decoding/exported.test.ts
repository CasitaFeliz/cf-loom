import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { exportedOrders } from '../../test/orders-exported.ts';
import { exportedSnapshotOf, providedSnapshotOf, type ServiceSnapshot } from '../internal/index.ts';

const orders = exportedOrders();
const providing = { name: 'orders-service', exportedSnapshot: orders };
const examples = new URL('../../../../examples/', import.meta.url);

/** The provider with its exported Snapshot replaced by what `change` makes of a copy of it. */
function changed(change: (copy: Record<string, unknown>) => void): typeof providing {
  const copy: Record<string, unknown> = structuredClone(orders);
  change(copy);
  return { ...providing, exportedSnapshot: copy as typeof orders };
}

function entryOf(copy: Record<string, unknown>, identity: string): Record<string, unknown> {
  const endpoints = copy['endpoints'] as Record<string, Record<string, unknown>>;
  const entry = endpoints[identity];
  if (entry === undefined) {
    throw new Error(`The fixture has no ${identity}`);
  }
  return entry;
}

describe('providedSnapshotOf', () => {
  test('an exported Snapshot in a format this cf-loom reads is read back as it was written', () => {
    const read = providedSnapshotOf(providing);

    expect(read).toStrictEqual(orders);
  });

  test.each(['orders-service', 'billing-service'])(
    'the exported Snapshot of the example %s is read back as it was written',
    (example) => {
      const file = new URL(`${example}/contract.snapshot.json`, examples);
      const declared: ServiceSnapshot = JSON.parse(readFileSync(file, 'utf8'));
      const exported = exportedSnapshotOf(declared);

      const read = providedSnapshotOf({ name: example, exportedSnapshot: exported });

      expect(read).toStrictEqual(exported);
    },
  );

  test.each([2, 99])(
    'an exported Snapshot in format %i, newer than this cf-loom reads, is refused',
    (format) => {
      const newer = changed((copy) => {
        copy['format'] = format;
      });

      const read = () => providedSnapshotOf(newer);

      expect(read).toThrow(
        `orders-service's exported Snapshot is in format ${format}, newer than this cf-loom reads: upgrade the @cf-loom packages`,
      );
    },
  );

  test.each([
    { given: 'a text', format: '1' },
    { given: 'none', format: undefined },
  ])('an exported Snapshot whose format is $given is refused as malformed', ({ format }) => {
    const damaged = changed((copy) => {
      copy['format'] = format;
    });

    const read = () => providedSnapshotOf(damaged);

    expect(read).toThrow(
      "orders-service's exported Snapshot is malformed: format is not a whole number from 1",
    );
  });

  test('an exported Snapshot that is no object is refused as malformed', () => {
    const read = () => providedSnapshotOf({ name: 'orders-service', exportedSnapshot: 'text' });

    expect(read).toThrow(
      "orders-service's exported Snapshot is malformed: format is not a whole number from 1",
    );
  });

  test('an Endpoint entry without its name is refused as malformed, naming the entry', () => {
    const damaged = changed((copy) => {
      delete entryOf(copy, 'GET /orders/{}')['name'];
    });

    const read = () => providedSnapshotOf(damaged);

    expect(read).toThrow(
      "orders-service's exported Snapshot is malformed: endpoints.GET /orders/{}.name is missing",
    );
  });

  test('an Endpoint entry with a key its format does not define is refused as malformed', () => {
    const damaged = changed((copy) => {
      entryOf(copy, 'GET /orders/{}')['extra'] = true;
    });

    const read = () => providedSnapshotOf(damaged);

    expect(read).toThrow(
      "orders-service's exported Snapshot is malformed: endpoints.GET /orders/{}.extra is a key its format does not define",
    );
  });

  test('a Retired Endpoint is refused, since a Contract Package exports none', () => {
    const damaged = changed((copy) => {
      entryOf(copy, 'GET /orders/{}')['lifecycle'] = 'retired';
    });

    const read = () => providedSnapshotOf(damaged);

    expect(read).toThrow(
      `orders-service's exported Snapshot is malformed: endpoints.GET /orders/{}.lifecycle is none of "active", "deprecated"`,
    );
  });

  test('a Retired Event is refused, since a Contract Package exports none', () => {
    const damaged = changed((copy) => {
      const events = copy['events'] as Record<string, Record<string, unknown>>;
      const event = events['OrderPlaced@1'];
      if (event === undefined) {
        throw new Error('The fixture has no OrderPlaced@1');
      }
      event['lifecycle'] = 'retired';
    });

    const read = () => providedSnapshotOf(damaged);

    expect(read).toThrow(
      `orders-service's exported Snapshot is malformed: events.OrderPlaced@1.lifecycle is none of "active", "deprecated"`,
    );
  });

  test('a top-level key its format does not define is refused as malformed', () => {
    const damaged = changed((copy) => {
      copy['subscriptions'] = {};
    });

    const read = () => providedSnapshotOf(damaged);

    expect(read).toThrow(
      "orders-service's exported Snapshot is malformed: subscriptions is a key its format does not define",
    );
  });

  test('a Deprecated Endpoint keeps its instant', () => {
    const read = providedSnapshotOf(providing);

    expect(read.endpoints['GET /old-orders/{}']).toMatchObject({
      lifecycle: 'deprecated',
      deprecatedAt: '2026-11-01T00:00:00Z',
    });
  });

  test('a code whose body breaks its format is refused as malformed, naming the code', () => {
    const damaged = changed((copy) => {
      copy['codes'] = { gone: { origin: 'local', status: 410, message: 'Gone', body: 'text' } };
    });

    const read = () => providedSnapshotOf(damaged);

    expect(read).toThrow(
      "orders-service's exported Snapshot is malformed: codes.gone.body is not an object",
    );
  });
});
