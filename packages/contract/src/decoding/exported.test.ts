import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { exportedOrders, getOrder, oldOrder, ordersSnapshot } from '../../test/orders-exported.ts';
import { aProvider } from '../../test/providers.ts';
import { seededNext } from '../../test/random-schemas.ts';
import { providedEndpoint } from '../index.ts';
import {
  decodeSnapshot,
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
      `orders-service's exported Snapshot is malformed: shadowing.GET /orders/latest.lifecycle is none of "active", "deprecated", "retired"`,
    );
  });

  test('a shadowing entry with a key its format does not define is refused as malformed', () => {
    const damaged = changed((copy) => {
      copy['shadowing'] = { 'GET /orders/latest': { lifecycle: 'active', name: 'latest' } };
    });

    const read = () => providedSnapshotOf(damaged);

    expect(read).toThrow(
      "orders-service's exported Snapshot is malformed: shadowing.GET /orders/latest.name is a key its format does not define",
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

/** An array of arrays, `levels` deep counting the outermost, of strings, built without recursion. */
function nestedArrays(levels: number): object {
  let nested: object = { type: 'string' };
  for (let level = 1; level < levels; level++) {
    nested = { type: 'array', items: nested };
  }
  return nested;
}

describe('providedSnapshotOf refuses a cut nested past the levels a Snapshot holds', () => {
  /** The exported cut with a def nesting `levels` levels below the cut, which is level 1. */
  function nestedCut(levels: number) {
    return changed((copy) => {
      copy['defs'] = { ...(copy['defs'] as object), deep: nestedArrays(levels - 2) };
    });
  }

  test.each([257, 20_000])(
    'a cut nested %i levels is refused as malformed at its deepest path',
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

    expect(read.defs['deep']).toStrictEqual(nestedArrays(254));
  });
});

describe('the Snapshot decoders never throw for a value JSON.parse returns', () => {
  /** JSON text `depth` containers deep, maps and arrays by turn, holding `width` objects at its bottom. */
  function wideAndDeep(width: number, depth: number): string {
    const opening: string[] = [];
    for (let level = 1; level < depth; level++) {
      opening.push(level % 2 === 0 ? '[' : '{"a":');
    }
    const closing = opening.map((open) => (open === '[' ? ']' : '}')).reverse();
    const bottom = `[${Array<string>(width).fill('{}').join(',')}]`;
    return `${opening.join('')}${bottom}${closing.join('')}`;
  }

  /** What a decoder does with a value: reads it, refuses it as malformed, or anything else it throws. */
  function outcomeOf(read: () => unknown): string {
    try {
      read();
      return 'read';
    } catch (e) {
      return e instanceof Error && e.message.includes(' is malformed: ') ? 'malformed' : String(e);
    }
  }

  test('random wide and deep values are decoded or refused, through decodeSnapshot and providedSnapshotOf', {
    timeout: 60_000,
  }, () => {
    const next = seededNext(340);
    const drawn = Array.from({ length: 8 }, () => ({
      width: Math.floor(next() * 300_000),
      depth: 1 + Math.floor(next() * 20_000),
    }));
    const values = [{ width: 300_000, depth: 1 }, { width: 0, depth: 20_000 }, ...drawn].map(
      ({ width, depth }) => wideAndDeep(width, depth),
    );

    const decoded = values.map((value) => {
      const text = JSON.stringify({ ...orders, kind: 'service' }).replace(
        /}$/,
        `,"extra":${value}}`,
      );
      return outcomeOf(() => {
        const result = decodeSnapshot(text);
        if (result.kind !== 'malformed' && result.kind !== 'decoded') {
          throw new Error(result.kind);
        }
      });
    });
    const provided = values.map((value) =>
      outcomeOf(() =>
        providedSnapshotOf(
          changed((copy) => {
            copy['defs'] = { deep: JSON.parse(value) };
          }),
        ),
      ),
    );

    expect(new Set(decoded)).toEqual(new Set(['read']));
    expect(new Set(provided)).toEqual(new Set(['malformed']));
  });
});
