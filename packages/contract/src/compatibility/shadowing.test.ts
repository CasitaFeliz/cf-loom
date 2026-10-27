import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { publishedBy } from '../../test/snapshots.ts';
import {
  type Change,
  type ComparedReport,
  compatibilityReportOf,
  type EndpointSnapshot,
  type ObjectNode,
  type PublishedServiceSnapshot,
  type SchemaNode,
  type ServiceSnapshot,
  walkSchemas,
} from '../internal/index.ts';

type Visibility = EndpointSnapshot['visibility'];
type Endpoints = Readonly<Record<string, Partial<EndpointSnapshot>>>;

const standardRejections: ServiceSnapshot['standardRejections'] = {
  invalidInput: 'INVALID_INPUT',
  notFound: 'NOT_FOUND',
  notImplemented: 'NOT_IMPLEMENTED',
};
const heading = {
  format: 1,
  kind: 'service',
  name: 'orders-service',
  standardRejections,
  groups: {},
  defs: {},
  guards: {},
  codes: {},
  events: {},
  commands: {},
  subscriptions: {},
  dependencies: {},
} as const;

const orderById = 'GET /orders/{}';
const latestOrder = 'GET /orders/latest';
const aString: SchemaNode = { type: 'string' };

function paramNamesOf(identity: string): readonly string[] {
  const placeholders = identity.split('{}').slice(1);
  return placeholders.map((_placeholder, index) => `param${index + 1}`);
}

function paramsNodeOf(names: readonly string[], schema: SchemaNode = aString): ObjectNode | null {
  if (names.length === 0) {
    return null;
  }
  const fields = names.map((name) => [name, { required: true, schema }] as const);
  return { type: 'object', fields: Object.fromEntries(fields) };
}

function anEndpoint(identity: string, fields: Partial<EndpointSnapshot> = {}): EndpointSnapshot {
  const params = fields.params ?? paramNamesOf(identity);
  return {
    name: identity,
    group: 'orders',
    visibility: 'public',
    lifecycle: 'active',
    description: 'An Endpoint',
    params,
    guards: [],
    input: {
      params: paramsNodeOf(params),
      query: { type: 'object', fields: {} },
      headers: { type: 'object', fields: {} },
      body: null,
    },
    success: { status: 200, headers: { type: 'object', fields: {} }, body: null },
    rejections: [],
    ...fields,
  } as EndpointSnapshot;
}

function publishedOf(endpoint: EndpointSnapshot): PublishedServiceSnapshot['endpoints'][string] {
  return endpoint.lifecycle === 'retired'
    ? { ...endpoint, lifecycle: 'retired', retiredIn: '2.0.0' }
    : (endpoint as PublishedServiceSnapshot['endpoints'][string]);
}

function aBaseline(
  endpoints: Endpoints,
  tombstones: readonly string[] = [],
): PublishedServiceSnapshot {
  const published = Object.entries(endpoints).map(
    ([identity, fields]) => [identity, publishedOf(anEndpoint(identity, fields))] as const,
  );
  const retired = tombstones.map(
    (identity) => [identity, { lifecycle: 'retired', retiredIn: '2.0.0', name: identity }] as const,
  );
  return {
    ...heading,
    version: '3.4.0',
    generator: publishedBy,
    formerInputs: [],
    endpoints: Object.fromEntries([...published, ...retired]),
  };
}

function aProposed(endpoints: Endpoints): ServiceSnapshot {
  const declared = Object.entries(endpoints).map(
    ([identity, fields]) => [identity, anEndpoint(identity, fields)] as const,
  );
  return { ...heading, endpoints: Object.fromEntries(declared) };
}

function reportOf(
  baseline: Endpoints,
  proposed: Endpoints,
  tombstones: readonly string[] = [],
): ComparedReport {
  const report = compatibilityReportOf(aBaseline(baseline, tombstones), aProposed(proposed));
  return report;
}

function isShadowing(change: Change): boolean {
  return change.difference.kind === 'shadowed';
}

function shadowedOf(
  baseline: Endpoints,
  proposed: Endpoints,
  tombstones: readonly string[] = [],
): readonly Change[] {
  return reportOf(baseline, proposed, tombstones).changes.filter(isShadowing);
}

function shadowing(identity: string, by: string, visibility: Visibility = 'public'): Change {
  return {
    site: { kind: 'endpoint', identity, name: identity, visibility },
    difference: { kind: 'shadowed', by },
    class: 'breaking',
    verdict: 'approval-needed',
  };
}

function added(identity: string): Change {
  return {
    site: { kind: 'endpoint', identity, name: identity, visibility: 'public' },
    difference: { kind: 'added' },
    class: 'additive',
    verdict: 'allowed',
  };
}

describe('compatibilityReportOf, shadowing', () => {
  test('adding GET /orders/latest beside GET /orders/{} is Breaking on the existing one, needs an Approval and names the new Endpoint', () => {
    const baseline = { [orderById]: {} };
    const proposed = { [orderById]: {}, [latestOrder]: {} };

    const report = reportOf(baseline, proposed);

    expect(report.changes).toEqual([added(latestOrder), shadowing(orderById, latestOrder)]);
  });

  test('a literal a uuid param refuses takes nothing from it', () => {
    const byUuid = byParam({ type: 'string', format: 'uuid' });
    const baseline = { [orderById]: byUuid };
    const proposed = { [orderById]: byUuid, [latestOrder]: {} };

    const changes = shadowedOf(baseline, proposed);

    expect(changes).toEqual([]);
  });

  test('an added Endpoint with a param where the existing one has a literal takes nothing', () => {
    const baseline = { [latestOrder]: {} };
    const proposed = { [latestOrder]: {}, [orderById]: {} };

    const changes = shadowedOf(baseline, proposed);

    expect(changes).toEqual([]);
  });

  test.each([
    { name: 'a param first', existing: orderById, taken: 'GET /{}/latest', shadowed: [] },
    {
      name: 'a literal first',
      existing: 'GET /{}/latest',
      taken: orderById,
      shadowed: ['GET /{}/latest'],
    },
  ])(
    'the literal at the first segment where two paths differ decides: the added Endpoint has $name',
    ({ existing, taken, shadowed }) => {
      const baseline = { [existing]: {} };
      const proposed = { [existing]: {}, [taken]: {} };

      const changes = shadowedOf(baseline, proposed);

      expect(changes).toEqual(shadowed.map((identity) => shadowing(identity, taken)));
    },
  );

  test('an Endpoint of another method shadows nothing', () => {
    const baseline = { [orderById]: {} };
    const proposed = { [orderById]: {}, 'POST /orders/latest': {} };

    const changes = shadowedOf(baseline, proposed);

    expect(changes).toEqual([]);
  });

  test('paths of different lengths shadow nothing', () => {
    const baseline = { [orderById]: {} };
    const proposed = {
      [orderById]: {},
      'GET /orders/latest/items': {},
      'GET /orders': {},
      'GET /': {},
    };

    const changes = shadowedOf(baseline, proposed);

    expect(changes).toEqual([]);
  });

  test('an added Endpoint whose literal differs from the existing one’s at the same position takes nothing', () => {
    const existing = 'GET /orders/{}/items';
    const baseline = { [existing]: {} };
    const proposed = { [existing]: {}, 'GET /orders/latest/lines': {} };

    const changes = shadowedOf(baseline, proposed);

    expect(changes).toEqual([]);
  });
});

/** An Endpoint whose one param has this schema. */
function byParam(schema: SchemaNode): Partial<EndpointSnapshot> {
  return {
    params: ['orderId'],
    input: {
      params: paramsNodeOf(['orderId'], schema),
      query: { type: 'object', fields: {} },
      headers: { type: 'object', fields: {} },
      body: null,
    },
  };
}

describe('compatibilityReportOf, shadowing reads the param’s schema on both sides', () => {
  const stats = 'GET /orders/stats';

  test('a literal a string param accepts is taken', () => {
    const baseline = { [orderById]: byParam(aString) };
    const proposed = { ...baseline, [stats]: {} };

    expect(shadowedOf(baseline, proposed)).toEqual([shadowing(orderById, stats)]);
  });

  test.each([
    ['12', 'GET /orders/12', true],
    ['latest', latestOrder, false],
  ])('beside an int param, the literal %s shadows: %s', (_text, added, shadows) => {
    const baseline = { [orderById]: byParam({ type: 'number', int: true }) };
    const proposed = { ...baseline, [added]: {} };

    const expected = shadows ? [shadowing(orderById, added)] : [];
    expect(shadowedOf(baseline, proposed)).toEqual(expected);
  });

  test.each([
    ['one of its values', 'GET /orders/open', true],
    ['none of its values', latestOrder, false],
  ])('beside an enum param, a literal that is %s', (_name, added, shadows) => {
    const baseline = {
      [orderById]: byParam({ type: 'enum', values: ['open', 'paid'], open: false }),
    };
    const proposed = { ...baseline, [added]: {} };

    const expected = shadows ? [shadowing(orderById, added)] : [];
    expect(shadowedOf(baseline, proposed)).toEqual(expected);
  });

  test('a literal a regex param refuses takes nothing', () => {
    const digits = byParam({ type: 'string', regex: { source: '^[0-9]+$', flags: '' } });
    const baseline = { [orderById]: digits };
    const proposed = { ...baseline, [latestOrder]: {} };

    expect(shadowedOf(baseline, proposed)).toEqual([]);
  });

  test('a uuid param widened to a string in the change that adds the literal is shadowed', () => {
    const baseline = { [orderById]: byParam({ type: 'string', format: 'uuid' }) };
    const proposed = { [orderById]: byParam(aString), [stats]: {} };

    expect(shadowedOf(baseline, proposed)).toEqual([shadowing(orderById, stats)]);
  });

  test('a param whose schema is a union, which the Snapshot alone does not decide, is shadowed', () => {
    const uuidOrNumber: SchemaNode = {
      type: 'union',
      options: [{ type: 'string', format: 'uuid' }, { type: 'number' }],
    };
    const baseline = { [orderById]: byParam(uuidOrNumber) };
    const proposed = { ...baseline, [stats]: {} };

    expect(shadowedOf(baseline, proposed)).toEqual([shadowing(orderById, stats)]);
  });
});

describe('compatibilityReportOf, shadowing, each rule a param refuses a literal by', () => {
  test.each<{ name: string; schema: SchemaNode; text: string; shadows: boolean }>([
    {
      name: 'an int param, a fraction',
      schema: { type: 'number', int: true },
      text: '7.5',
      shadows: false,
    },
    {
      name: 'a multipleOf(4) param, 6',
      schema: { type: 'number', multipleOf: 4 },
      text: '6',
      shadows: false,
    },
    {
      name: 'a multipleOf(4) param, 8',
      schema: { type: 'number', multipleOf: 4 },
      text: '8',
      shadows: true,
    },
    {
      name: 'a multipleOf(3) param, a large multiple',
      schema: { type: 'number', multipleOf: 3 },
      text: '4111111111111111',
      shadows: true,
    },
    {
      name: 'a .gt(5) param, 5',
      schema: { type: 'number', exclusiveMin: 5 },
      text: '5',
      shadows: false,
    },
    {
      name: 'a .lt(5) param, 5',
      schema: { type: 'number', exclusiveMax: 5 },
      text: '5',
      shadows: false,
    },
    {
      name: 'a length-bounded param, a shorter text',
      schema: { type: 'string', min: 3, max: 5 },
      text: 'ab',
      shadows: false,
    },
    {
      name: 'a length-bounded param, a longer text',
      schema: { type: 'string', min: 3, max: 5 },
      text: 'abcdef',
      shadows: false,
    },
    {
      name: 'a length-bounded param, a text within',
      schema: { type: 'string', min: 3, max: 5 },
      text: 'abcd',
      shadows: true,
    },
    {
      name: 'an open enum param, a value it does not list',
      schema: { type: 'enum', values: ['open'], open: true },
      text: 'latest',
      shadows: true,
    },
  ])('$name: the literal is taken: $shadows', ({ schema, text, shadows }) => {
    const added = `GET /orders/${text}`;
    const baseline = { [orderById]: byParam(schema) };
    const proposed = { ...baseline, [added]: {} };

    const expected = shadows ? [shadowing(orderById, added)] : [];
    expect(shadowedOf(baseline, proposed)).toEqual(expected);
  });
});

describe('compatibilityReportOf, shadowing agrees with what the author’s schemas accept', () => {
  const schemas: readonly z.ZodType[] = [
    z.string(),
    z.uuid(),
    z.email(),
    z.iso.date(),
    z.string().regex(/^[a-z]+$/),
    z.string().min(3).max(5),
    z.int(),
    z.int().min(0).max(100),
    z.number().gt(5),
    z.number().multipleOf(4),
    z.number().multipleOf(3),
    z.boolean(),
    z.enum(['open', 'paid']),
    z.literal('stats'),
  ];
  const texts = [
    'stats',
    'open',
    '12',
    '7.5',
    '-3',
    'true',
    'abcd',
    '2026-01-02',
    'a@b.co',
    '4111111111111111',
  ];

  function nodeOf(schema: z.ZodType): SchemaNode {
    const [located] = walkSchemas(
      [
        {
          at: { site: { kind: 'export', name: 'param' }, declaration: undefined, steps: [] },
          schema,
        },
      ],
      () => undefined,
    ).located;
    if (located?.walked.kind !== 'walked') {
      throw new Error('A drawn param schema walks.');
    }
    return located.walked.value;
  }

  /** Whether a schema accepts a text under any reading the runtime could give it. */
  function accepts(schema: z.ZodType, text: string): boolean {
    const booleans: Readonly<Record<string, boolean>> = { true: true, false: false };
    const readings = [text, Number(text), booleans[text] ?? text];
    return readings.some((reading) => schema.safeParse(reading).success);
  }

  test('a literal is taken whenever either side’s schema may accept it, and only then', () => {
    let state = 2235;
    const next = () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 2 ** 32;
    };
    const pick = <Value>(values: readonly Value[]) =>
      values[Math.floor(next() * values.length)] as Value;
    let untaken = 0;
    for (let draw = 0; draw < 300; draw += 1) {
      const [before, after, text] = [pick(schemas), pick(schemas), pick(texts)];
      const added = `GET /orders/${text}`;
      const baseline = { [orderById]: byParam(nodeOf(before)) };
      const proposed = { [orderById]: byParam(nodeOf(after)), [added]: {} };

      const isShadowed = shadowedOf(baseline, proposed).length > 0;

      const label = `draw ${draw}: ${text} beside ${JSON.stringify([nodeOf(before), nodeOf(after)])}`;
      const mayAccept = accepts(before, text) || accepts(after, text);
      untaken += isShadowed ? 0 : 1;
      expect(isShadowed || !mayAccept, label).toBe(true);
    }
    expect(untaken).toBeGreaterThan(30);
  });
});

describe('compatibilityReportOf, shadowing, which Endpoint wins the URL', () => {
  test('a URL another existing Endpoint already won is not lost again', () => {
    const baseline = { 'GET /{}/{}': {}, [orderById]: {} };
    const proposed = { ...baseline, [latestOrder]: {} };

    const changes = shadowedOf(baseline, proposed);

    expect(changes).toEqual([shadowing(orderById, latestOrder)]);
  });

  test('both existing Endpoints that lose part of an overlap are shadowed', () => {
    const baseline = { 'GET /{}/{}': {}, 'GET /{}/y': {} };
    const proposed = { ...baseline, 'GET /x/{}': {} };

    const changes = shadowedOf(baseline, proposed);

    expect(changes).toEqual([
      shadowing('GET /{}/y', 'GET /x/{}'),
      shadowing('GET /{}/{}', 'GET /x/{}'),
    ]);
  });

  test('a text where both paths have a param is one no other Endpoint’s literal matches', () => {
    const baseline = { 'GET /{}/{}': {}, 'GET /latest/{}': {} };
    const proposed = { ...baseline, 'GET /{}/a': {} };

    const changes = shadowedOf(baseline, proposed);

    expect(changes).toEqual([shadowing('GET /{}/{}', 'GET /{}/a')]);
  });

  test('of several added Endpoints, only the one that wins the URL is named', () => {
    const baseline = { [orderById]: {} };
    const proposed = { ...baseline, 'GET /{}/latest': {}, [latestOrder]: {} };

    const changes = shadowedOf(baseline, proposed);

    expect(changes).toEqual([shadowing(orderById, latestOrder)]);
  });

  test('an Endpoint that loses URLs to two added Endpoints gets one Change for each, by identity in code point order', () => {
    const baseline = { 'GET /{}/{}': {} };
    const proposed = { ...baseline, 'GET /users/{}': {}, [orderById]: {} };

    const changes = shadowedOf(baseline, proposed);

    expect(changes).toEqual([
      shadowing('GET /{}/{}', orderById),
      shadowing('GET /{}/{}', 'GET /users/{}'),
    ]);
  });

  test('Endpoints added in the same change take nothing from each other', () => {
    const baseline = { 'GET /health': {} };
    const proposed = { ...baseline, [orderById]: {}, [latestOrder]: {} };

    const changes = shadowedOf(baseline, proposed);

    expect(changes).toEqual([]);
  });
});

describe('compatibilityReportOf, shadowing, Retired Endpoints', () => {
  test.each([
    ['Retired on both sides', { lifecycle: 'retired' }, { lifecycle: 'retired' }],
    ['retired in this change', {}, { lifecycle: 'retired' }],
  ] as const)('a Retired Endpoint loses nothing: %s', (_case, before, after) => {
    const baseline = { [orderById]: before };
    const proposed = { [orderById]: after, [latestOrder]: {} };

    const changes = shadowedOf(baseline, proposed);

    expect(changes).toEqual([]);
  });

  test('an added Retired Endpoint still shadows, since the wire routes it', () => {
    const baseline = { [orderById]: {} };
    const proposed = { [orderById]: {}, [latestOrder]: { lifecycle: 'retired' } } as const;

    const changes = shadowedOf(baseline, proposed);

    expect(changes).toEqual([shadowing(orderById, latestOrder)]);
  });

  test('a still-declared Retired Endpoint keeps the URLs it won: an added Endpoint overlapping them takes nothing from the param Endpoint', () => {
    const baseline = { [orderById]: {}, [latestOrder]: { lifecycle: 'retired' } } as const;
    const proposed = { ...baseline, 'GET /{}/latest': {} };

    const changes = shadowedOf(baseline, proposed);

    expect(changes).toEqual([]);
  });

  test('an Endpoint declared again at a tombstone’s identity takes URLs like any added one', () => {
    const baseline = { [orderById]: {} };
    const proposed = { [orderById]: {}, [latestOrder]: {} };

    const changes = shadowedOf(baseline, proposed, [latestOrder]);

    expect(changes).toEqual([shadowing(orderById, latestOrder)]);
  });

  test('deleting a Retired Endpoint gives no shadowing, only its Neutral tombstone', () => {
    const baseline = { [orderById]: {}, [latestOrder]: { lifecycle: 'retired' } } as const;
    const proposed = { [orderById]: {} };

    const report = reportOf(baseline, proposed);

    expect(report.changes).toEqual([
      {
        site: { kind: 'endpoint', identity: latestOrder, name: latestOrder, visibility: 'public' },
        difference: { kind: 'tombstoned' },
        class: 'neutral',
        verdict: 'allowed',
      },
    ]);
  });
});

describe('compatibilityReportOf, shadowing, Visibility and order', () => {
  test('a shadowed Private Endpoint is Breaking and needs an Approval', () => {
    const baseline = { [orderById]: { visibility: 'private' } } as const;
    const proposed = { ...baseline, [latestOrder]: { visibility: 'private' } } as const;

    const changes = shadowedOf(baseline, proposed);

    expect(changes).toEqual([shadowing(orderById, latestOrder, 'private')]);
  });

  test('a Private Endpoint added shadows a Public one', () => {
    const baseline = { [orderById]: {} };
    const proposed = { [orderById]: {}, [latestOrder]: { visibility: 'private' } } as const;

    const changes = shadowedOf(baseline, proposed);

    expect(changes).toEqual([shadowing(orderById, latestOrder, 'public')]);
  });

  test('shadowing comes after a rename and before the params', () => {
    const baseline = { [orderById]: { name: 'getOrder' } };
    const proposed = {
      [orderById]: { name: 'fetchOrder', params: ['id'] },
      [latestOrder]: {},
    };

    const report = reportOf(baseline, proposed);

    const kinds = report.changes
      .filter((change) => change.site.kind === 'endpoint' && change.site.identity === orderById)
      .map((change) => change.difference.kind);
    expect(kinds).toEqual(['renamed', 'shadowed', 'param-renamed']);
  });
});
