import { describe, expect, test } from 'vitest';
import {
  type Change,
  type ComparedReport,
  compatibilityReportOf,
  type EndpointSnapshot,
  type ObjectNode,
  type PublishedServiceSnapshot,
  type SchemaNode,
  type ServiceSnapshot,
} from '../internal/index.ts';

type Visibility = EndpointSnapshot['visibility'];
type Endpoints = Readonly<Record<string, Partial<EndpointSnapshot>>>;

const standardRejections: ServiceSnapshot['standardRejections'] = {
  invalidInput: { origin: 'standard', code: 'INVALID_INPUT', status: 400, message: 'Invalid' },
  notFound: { origin: 'standard', code: 'NOT_FOUND', status: 404, message: 'Not found' },
  notImplemented: { origin: 'standard', code: 'NOT_IMPLEMENTED', status: 501, message: 'No' },
};
const heading = {
  format: 1,
  kind: 'service',
  name: 'orders-service',
  generator: '@cf-loom/cli@2.1.0',
  definitions: {},
  standardRejections,
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
    input: { params: paramsNodeOf(params), query: null, headers: null, body: null },
    success: { status: 200, headers: null, body: null },
    rejections: [],
    ...fields,
  };
}

function publishedOf(endpoint: EndpointSnapshot): PublishedServiceSnapshot['endpoints'][string] {
  return endpoint.lifecycle === 'retired'
    ? { ...endpoint, lifecycle: 'retired', retiredIn: '2.0.0' }
    : { ...endpoint, lifecycle: endpoint.lifecycle };
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
  if (report.kind !== 'compared') {
    throw new Error('the Baseline was given, so the report must have compared');
  }
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

  test('a literal takes a uuid param’s URLs: the param’s schema is not read', () => {
    const uuid: SchemaNode = { type: 'string', format: 'uuid' };
    const byUuid = {
      params: ['orderId'],
      input: { params: paramsNodeOf(['orderId'], uuid), query: null, headers: null, body: null },
    };
    const baseline = { [orderById]: byUuid };
    const proposed = { [orderById]: byUuid, [latestOrder]: {} };

    const changes = shadowedOf(baseline, proposed);

    expect(changes).toEqual([shadowing(orderById, latestOrder)]);
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
