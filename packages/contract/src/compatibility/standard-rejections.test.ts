import { describe, expect, test } from 'vitest';
import { publishedBy, schemaExports } from '../../test/snapshots.ts';
import {
  type Change,
  type ChangeSite,
  type CodeSnapshot,
  compatibilityReportOf,
  type DefinitionsSnapshot,
  type EndpointSnapshot,
  type PublishedDefinitionsSnapshot,
  type PublishedServiceSnapshot,
  type ServiceSnapshot,
} from '../internal/index.ts';

type Standard = ServiceSnapshot['standardRejections'];
type Visibility = EndpointSnapshot['visibility'];

const identity = 'GET /orders/{}';
const resolved: Standard = {
  invalidInput: 'INVALID_INPUT',
  notFound: 'NOT_FOUND',
  notImplemented: 'NOT_IMPLEMENTED',
};
const remapped: Standard = { ...resolved, notFound: 'ORDER_GONE' };

function aStandardCode(status: number): CodeSnapshot {
  return {
    origin: 'standard',
    status,
    message: 'Standard',
    headers: { type: 'object', fields: {} },
    body: null,
  };
}

/** The codes a Snapshot holds for a resolution: each Standard Rejection's. */
function codesFor(standard: Standard): Record<string, CodeSnapshot> {
  return {
    [standard.invalidInput]: aStandardCode(400),
    [standard.notFound]: aStandardCode(404),
    [standard.notImplemented]: aStandardCode(501),
  };
}

function anEndpoint(rejections: readonly string[], visibility: Visibility): EndpointSnapshot {
  return {
    name: 'getOrder',
    group: 'orders',
    visibility,
    lifecycle: 'active',
    description: 'One order',
    params: [],
    guards: [],
    input: {
      params: null,
      query: { type: 'object', fields: {} },
      headers: { type: 'object', fields: {} },
      body: null,
    },
    success: { status: 200, headers: { type: 'object', fields: {} }, body: null },
    rejections,
  };
}

function aService(
  standard: Standard,
  endpoints: ServiceSnapshot['endpoints'] = {},
): ServiceSnapshot {
  return {
    format: 1,
    kind: 'service',
    name: 'orders-service',
    standardRejections: standard,
    groups: {},
    defs: {},
    endpoints,
    events: {},
    commands: {},
    guards: {},
    codes: codesFor(standard),
    subscriptions: {},
    dependencies: {},
  };
}

function published({ endpoints, ...snapshot }: ServiceSnapshot): PublishedServiceSnapshot {
  const live = Object.entries(endpoints).map(([key, endpoint]) => [
    key,
    { ...endpoint, lifecycle: 'active' } as const,
  ]);
  return {
    ...snapshot,
    version: '3.4.0',
    generator: publishedBy,
    endpoints: Object.fromEntries(live),
    events: {},
    commands: {},
  };
}

function aDefinitions(standard: Standard): DefinitionsSnapshot {
  return {
    format: 1,
    kind: 'definitions',
    name: '@org/definitions',
    standardRejections: standard,
    defs: {},
    exports: schemaExports({}),
    guards: {},
    codes: codesFor(standard),
  };
}

function site(visibility: Visibility): ChangeSite {
  return { kind: 'standard-rejection', name: 'notFound', visibility };
}

function neutral(visibility: Visibility, from: string, to: string): Change {
  return {
    site: site(visibility),
    difference: { kind: 'code-changed', from, to },
    class: 'neutral',
    verdict: 'allowed',
  };
}

describe('compatibilityReportOf, a Service’s Standard Rejections', () => {
  test('a Standard Rejection resolving to another code no Endpoint lists is one Neutral code-changed, Private', () => {
    const baseline = published(aService(resolved));
    const proposed = aService(remapped);

    const { changes } = compatibilityReportOf(baseline, proposed);

    expect(changes).toEqual([neutral('private', 'NOT_FOUND', 'ORDER_GONE')]);
  });

  test('the Endpoints that list either code report the codes too, and set the site’s Visibility', () => {
    const baseline = published(
      aService(resolved, { [identity]: anEndpoint(['NOT_FOUND'], 'internal') }),
    );
    const proposed = aService(remapped, { [identity]: anEndpoint(['ORDER_GONE'], 'internal') });

    const { changes } = compatibilityReportOf(baseline, proposed);

    expect(changes.map(({ site: { kind }, difference }) => [kind, difference.kind])).toEqual([
      ['endpoint', 'rejection-removed'],
      ['endpoint', 'rejection-added'],
      ['standard-rejection', 'code-changed'],
    ]);
    expect(changes.at(-1)).toEqual(neutral('internal', 'NOT_FOUND', 'ORDER_GONE'));
  });

  test.each([
    ['the old code', [['NOT_FOUND'], 'public'], [[], 'internal']],
    ['the new code', [[], 'internal'], [['ORDER_GONE'], 'public']],
    [
      'the old code, and an Internal one the new',
      [['NOT_FOUND'], 'public'],
      [['ORDER_GONE'], 'internal'],
    ],
    [
      'the new code, and an Internal one the old',
      [['NOT_FOUND'], 'internal'],
      [['ORDER_GONE'], 'public'],
    ],
  ] as const)('the site is Public when a Public Endpoint lists %s', (_name, was, now) => {
    const baseline = published(aService(resolved, { [identity]: anEndpoint(was[0], was[1]) }));
    const proposed = aService(remapped, { [identity]: anEndpoint(now[0], now[1]) });

    const { changes } = compatibilityReportOf(baseline, proposed);

    expect(changes.at(-1)).toEqual(neutral('public', 'NOT_FOUND', 'ORDER_GONE'));
  });

  test('a Standard Rejection resolved as before gives no Change', () => {
    const baseline = published(aService(resolved));

    const { changes } = compatibilityReportOf(baseline, aService(resolved));

    expect(changes).toEqual([]);
  });
});

describe('compatibilityReportOf, a Definitions Package’s Standard Rejections', () => {
  test('a Standard Rejection resolving to another code is one Neutral code-changed, Public, beside the code it adds', () => {
    const baseline: PublishedDefinitionsSnapshot = {
      ...aDefinitions(resolved),
      version: '4.2.0',
      generator: publishedBy,
    };

    const { changes } = compatibilityReportOf(baseline, aDefinitions(remapped));

    expect(changes.map(({ site: { kind }, difference }) => [kind, difference.kind])).toEqual([
      ['code', 'added'],
      ['standard-rejection', 'code-changed'],
    ]);
    expect(changes.at(-1)).toEqual(neutral('public', 'NOT_FOUND', 'ORDER_GONE'));
  });
});
