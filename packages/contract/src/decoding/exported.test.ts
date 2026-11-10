import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { exportedOrders, getOrder, oldOrder, ordersSnapshot } from '../../test/orders-exported.ts';
import { aProvider } from '../../test/providers.ts';
import { seededNext } from '../../test/random-schemas.ts';
import { providedEndpoint } from '../index.ts';
import {
  exportedCutOf,
  exportedSnapshotOf,
  providedSnapshotOf,
  type ServiceSnapshot,
} from '../internal/index.ts';

const orders = exportedOrders();
const examples = new URL('../../../../examples/', import.meta.url);

/**
 * Any Endpoint a Contract Package exports, as `provider`'s, carrying `cut` as its exported
 * Snapshot cut: the decoder reads the cut and the Provider's name, not the Endpoint.
 */
function markedAs(provider: string, cut: unknown) {
  return providedEndpoint(aProvider(provider), getOrder, cut);
}

function carrying(cut: unknown) {
  return markedAs('orders-service', cut);
}

const providing = carrying(orders);

/** The Endpoint carrying what `change` makes of a copy of its exported Snapshot. */
function changed(change: (copy: Record<string, unknown>) => void): typeof providing {
  const copy: Record<string, unknown> = structuredClone(orders);
  change(copy);
  return carrying(copy);
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
  test('an Endpoint’s exported Snapshot cut in a format this cf-loom reads is read back as it was written', () => {
    const read = providedSnapshotOf(providing);

    expect(read).toStrictEqual(orders);
  });

  test.each(['orders-service', 'billing-service'])(
    'the cut of every Endpoint of the example %s is read back as it was written, whatever Endpoint carries it',
    (example) => {
      const file = new URL(`${example}/contract.snapshot.json`, examples);
      const declared: ServiceSnapshot = JSON.parse(readFileSync(file, 'utf8'));
      const cuts = Object.keys(exportedSnapshotOf(declared).endpoints).map((identity) =>
        exportedCutOf(declared, identity),
      );

      const read = cuts.map((cut) => providedSnapshotOf(markedAs(example, cut)));

      expect(read).toStrictEqual(cuts);
    },
  );

  test('an Endpoint no Contract Package exports carries no exported Snapshot', () => {
    const read = () => providedSnapshotOf(getOrder);

    expect(read).toThrow(
      'getOrder is no Endpoint a Contract Package exports, so it carries no exported Snapshot',
    );
  });

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
    const read = () => providedSnapshotOf(carrying('text'));

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
      `orders-service's exported Snapshot is malformed: endpoints."GET /orders/{}".name is missing`,
    );
  });

  test('an Endpoint entry with a key its format does not define is refused as malformed', () => {
    const damaged = changed((copy) => {
      entryOf(copy, 'GET /orders/{}')['extra'] = true;
    });

    const read = () => providedSnapshotOf(damaged);

    expect(read).toThrow(
      `orders-service's exported Snapshot is malformed: endpoints."GET /orders/{}".extra is a key its format does not define`,
    );
  });

  test('a Retired Endpoint is refused, since a Contract Package exports none', () => {
    const damaged = changed((copy) => {
      entryOf(copy, 'GET /orders/{}')['lifecycle'] = 'retired';
    });

    const read = () => providedSnapshotOf(damaged);

    expect(read).toThrow(
      `orders-service's exported Snapshot is malformed: endpoints."GET /orders/{}".lifecycle is not "active" or "deprecated"`,
    );
  });

  test('a cut that carries events is refused as malformed, since a cut holds no Event', () => {
    const damaged = changed((copy) => {
      copy['events'] = {};
    });

    const read = () => providedSnapshotOf(damaged);

    expect(read).toThrow(
      "orders-service's exported Snapshot is malformed: events is a key its format does not define",
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

  test.each(['active', 'deprecated', 'retired'])(
    'an Endpoint shadowing as %s is read back as it was written',
    (lifecycle) => {
      const shadowed = changed((copy) => {
        copy['shadowing'] = { 'GET /orders/latest': { lifecycle } };
      });

      const read = providedSnapshotOf(shadowed);

      expect(read.shadowing).toStrictEqual({ 'GET /orders/latest': { lifecycle } });
    },
  );

  test('a shadowing entry whose lifecycle is none of the three is refused as malformed, naming the entry', () => {
    const damaged = changed((copy) => {
      copy['shadowing'] = { 'GET /orders/latest': { lifecycle: 'gone' } };
    });

    const read = () => providedSnapshotOf(damaged);

    expect(read).toThrow(
      `orders-service's exported Snapshot is malformed: shadowing."GET /orders/latest".lifecycle is not "active", "deprecated" or "retired"`,
    );
  });

  test('a shadowing entry with a key its format does not define is refused as malformed', () => {
    const damaged = changed((copy) => {
      copy['shadowing'] = { 'GET /orders/latest': { lifecycle: 'active', name: 'latest' } };
    });

    const read = () => providedSnapshotOf(damaged);

    expect(read).toThrow(
      `orders-service's exported Snapshot is malformed: shadowing."GET /orders/latest".name is a key its format does not define`,
    );
  });

  test.each([
    { map: 'shadowing', entry: { lifecycle: 'active' } },
    { map: 'endpoints', entry: { ...orders.endpoints['GET /orders/{}'] } },
  ])(
    'a key of $map that is no Endpoint’s identity is refused as malformed, naming the key',
    ({ map, entry }) => {
      const damaged = changed((copy) => {
        const keyed = copy[map] as Record<string, unknown>;
        keyed['garbage'] = entry;
      });

      const read = () => providedSnapshotOf(damaged);

      expect(read).toThrow(
        `orders-service's exported Snapshot is malformed: ${map}.garbage is not an Endpoint’s identity: a method and a path with its params as {}`,
      );
    },
  );

  test('an exported Snapshot without shadowing is refused as malformed', () => {
    const damaged = changed((copy) => {
      delete copy['shadowing'];
    });

    const read = () => providedSnapshotOf(damaged);

    expect(read).toThrow("orders-service's exported Snapshot is malformed: shadowing is missing");
  });

  test('a Deprecated Endpoint keeps its instant', () => {
    const cut = exportedCutOf(ordersSnapshot(), 'GET /old-orders/{}');

    const read = providedSnapshotOf(providedEndpoint(aProvider('orders-service'), oldOrder, cut));

    expect(read.endpoints['GET /old-orders/{}']).toMatchObject({
      lifecycle: 'deprecated',
      deprecatedAt: '2026-11-01T00:00:00Z',
    });
  });

  test('a Deprecated Endpoint without its instant is refused as malformed, naming deprecatedAt', () => {
    const cut = structuredClone(exportedCutOf(ordersSnapshot(), 'GET /old-orders/{}'));
    delete entryOf(cut as Record<string, unknown>, 'GET /old-orders/{}')['deprecatedAt'];

    const read = () =>
      providedSnapshotOf(providedEndpoint(aProvider('orders-service'), oldOrder, cut));

    expect(read).toThrow(
      `orders-service's exported Snapshot is malformed: endpoints."GET /old-orders/{}".deprecatedAt is missing`,
    );
  });

  test.each([
    ['body', { headers: { type: 'object', fields: {} }, body: 'text' }],
    ['headers', { headers: 'text', body: null }],
  ])('a code whose %s break its format is refused as malformed, naming the code', (part, held) => {
    const damaged = changed((copy) => {
      copy['codes'] = { gone: { origin: 'local', status: 410, message: 'Gone', ...held } };
    });

    const read = () => providedSnapshotOf(damaged);

    expect(read).toThrow(
      `orders-service's exported Snapshot is malformed: codes.gone.${part} is not an object`,
    );
  });

  test('a code with no headers is refused as malformed, naming the code', () => {
    const damaged = changed((copy) => {
      copy['codes'] = { gone: { origin: 'local', status: 410, message: 'Gone', body: null } };
    });

    const read = () => providedSnapshotOf(damaged);

    expect(read).toThrow(
      "orders-service's exported Snapshot is malformed: codes.gone.headers is missing",
    );
  });

  test('a removed code is refused as malformed, since no Endpoint answers a code a cut holds', () => {
    const damaged = changed((copy) => {
      const gone = {
        origin: 'local',
        status: 410,
        message: 'Gone',
        body: null,
        removedIn: '3.2.0',
      };
      copy['codes'] = { gone: { ...gone, headers: { type: 'object', fields: {} }, defs: {} } };
    });

    const read = () => providedSnapshotOf(damaged);

    expect(read).toThrow(
      "orders-service's exported Snapshot is malformed: codes.gone.removedIn is a key its format does not define",
    );
  });
});

/** A schema of `containers` array nodes one inside the other, the innermost holding strings. */
function containersDeep(containers: number): object {
  let nested: object = { type: 'string' };
  for (let level = 1; level < containers; level++) {
    nested = { type: 'array', items: nested };
  }
  return nested;
}

/** A `json` schema holding one example that is an array of `width` objects. */
function wideNode(width: number): object {
  return { type: 'json', examples: [Array.from({ length: width }, () => ({}))] };
}

describe('providedSnapshotOf reads a cut as wide and as deep as a Snapshot holds', () => {
  /** The exported cut with the defs written over those it has. */
  function withDefs(defs: object) {
    return changed((copy) => {
      copy['defs'] = { ...(copy['defs'] as object), ...defs };
    });
  }

  /** The exported cut with a def nesting `levels` levels below the cut, which is level 1. */
  function nestedCut(levels: number) {
    return withDefs({ deep: containersDeep(levels - 2) });
  }

  /** What a decoder does with a cut: reads it, refuses it as malformed, or anything else it throws. */
  function outcomeOf(read: () => unknown): string {
    try {
      read();
      return 'read';
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  }

  test.each([257, 20_000])(
    'a cut nested %i levels is refused as malformed at the first level past the limit',
    (levels) => {
      const read = () => providedSnapshotOf(nestedCut(levels));

      const at = ['defs', 'deep', ...Array<string>(254).fill('items')].join('.');
      expect(read).toThrow(
        `orders-service's exported Snapshot is malformed: ${at} nests deeper than 256 levels`,
      );
    },
  );

  test('a cut nested exactly 256 levels is read', () => {
    const read = providedSnapshotOf(nestedCut(256));

    expect(read.defs['deep']).toStrictEqual(containersDeep(254));
  });

  test('a cut holding a json example of 300,000 objects is read', () => {
    const read = providedSnapshotOf(withDefs({ wide: wideNode(300_000) }));

    expect(read.defs['wide']).toStrictEqual(wideNode(300_000));
  });

  test('random wide and deep cuts are read within the limit and refused past it, never a throw', () => {
    const next = seededNext(343);
    const draws = Array.from({ length: 10 }, (_, draw) => {
      const refused = draw % 2 === 1;
      const levels = refused ? 300 + Math.floor(next() * 20_000) : 1 + Math.floor(next() * 250);
      return { refused, width: Math.floor(next() * 300_000), levels };
    });

    const outcomes = draws.map(({ width, levels }) =>
      outcomeOf(() =>
        providedSnapshotOf(withDefs({ a: wideNode(width), b: containersDeep(levels) })),
      ),
    );

    const at = ['defs', 'b', ...Array<string>(254).fill('items')].join('.');
    const refusal = `orders-service's exported Snapshot is malformed: ${at} nests deeper than 256 levels`;
    expect(outcomes).toEqual(draws.map(({ refused }) => (refused ? refusal : 'read')));
  });
});
