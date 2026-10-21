import { describe, expect, test } from 'vitest';
import {
  type Change,
  type ChangeSite,
  compatibilityReportOf,
  type DependencyGraph,
  type DependencySnapshot,
  type EndpointSnapshot,
  type EventSnapshot,
  type GraphPackage,
  type PublishedServiceSnapshot,
  type ServiceSnapshot,
} from '../internal/index.ts';

type Visibility = EndpointSnapshot['visibility'];
type Lifecycle = EndpointSnapshot['lifecycle'];

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
  dependencies: {},
} as const;
const emptyObject = { type: 'object', mode: 'strict', fields: {} } as const;
const orderIdParam = {
  type: 'object',
  mode: 'strict',
  fields: { orderId: { required: true, schema: { type: 'string' } } },
} as const;

function anEndpoint(fields: Partial<EndpointSnapshot> = {}): EndpointSnapshot {
  return {
    name: 'getOrder',
    group: 'orders',
    visibility: 'public',
    lifecycle: 'active',
    description: 'One order',
    params: ['orderId'],
    guards: [],
    input: { params: orderIdParam, query: null, headers: null, body: null },
    success: { status: 200, headers: null, body: null },
    rejections: [],
    ...fields,
  };
}

function anEvent(fields: Partial<EventSnapshot> = {}): EventSnapshot {
  return {
    visibility: 'internal',
    lifecycle: 'active',
    description: 'An order was placed',
    body: emptyObject,
    ...fields,
  };
}

function aLive<Element extends { readonly lifecycle: Lifecycle }>(
  element: Element,
  lifecycle: 'active' | 'deprecated' = 'active',
): Element & { readonly lifecycle: 'active' | 'deprecated' } {
  return { ...element, lifecycle };
}

function aBaseline(fields: Partial<PublishedServiceSnapshot> = {}): PublishedServiceSnapshot {
  return {
    ...heading,
    version: '3.4.0',
    endpoints: {},
    events: {},
    commands: {},
    subscriptions: {},
    ...fields,
  };
}

function aProposed(fields: Partial<ServiceSnapshot> = {}): ServiceSnapshot {
  return { ...heading, endpoints: {}, events: {}, commands: {}, subscriptions: {}, ...fields };
}

function aGraphPackage(fields: Partial<GraphPackage> = {}): GraphPackage {
  return {
    name: 'billing-service',
    version: '2.1.0',
    kind: 'service',
    dependencies: {},
    ...fields,
  };
}

function usingOrders(dependency: Partial<DependencySnapshot>): GraphPackage['dependencies'] {
  return { 'orders-service': { against: '3.4.0', endpoints: [], events: [], ...dependency } };
}

const getOrder = { id: 'GET /orders/{}', name: 'getOrder' };
const orderPlaced = 'OrderPlaced@1';

function aServiceUsing(dependency: Partial<DependencySnapshot>, version = '2.1.0'): GraphPackage {
  return aGraphPackage({ version, dependencies: usingOrders(dependency) });
}

function anApplicationUsing(dependency: Partial<DependencySnapshot>): GraphPackage {
  return aGraphPackage({
    name: 'web-app',
    version: '1.0.0',
    kind: 'application',
    dependencies: usingOrders(dependency),
  });
}

function changesOf(
  baseline: PublishedServiceSnapshot,
  proposed: ServiceSnapshot,
  graph: DependencyGraph,
): readonly Change[] {
  const report = compatibilityReportOf(baseline, proposed, graph);
  if (report.kind !== 'compared') {
    throw new Error('the Baseline was given, so the report must have compared');
  }
  return report.changes;
}

function endpointSite(visibility: Visibility): ChangeSite {
  return { kind: 'endpoint', identity: 'GET /orders/{}', visibility };
}

function eventSite(visibility: 'internal' | 'private'): ChangeSite {
  return { kind: 'event', identity: orderPlaced, visibility };
}

function endpointAt(visibility: Visibility, fields: Partial<EndpointSnapshot> = {}) {
  return { endpoints: { 'GET /orders/{}': anEndpoint({ visibility, ...fields }) } };
}

function publishedEndpointAt(
  visibility: Visibility,
  lifecycle: 'active' | 'deprecated' = 'active',
) {
  return { endpoints: { 'GET /orders/{}': aLive(anEndpoint({ visibility }), lifecycle) } };
}

describe('compatibilityReportOf, the dependency graph, retirement', () => {
  test('retiring an Endpoint a Dependency uses is not allowed, naming each package at its major’s version', () => {
    const graph: DependencyGraph = [
      anApplicationUsing({ endpoints: [getOrder] }),
      aServiceUsing({ endpoints: [getOrder] }, '3.0.0'),
      aServiceUsing({ endpoints: [getOrder] }, '2.1.0'),
    ];
    const baseline = aBaseline(publishedEndpointAt('public', 'deprecated'));
    const proposed = aProposed(endpointAt('public', { lifecycle: 'retired' }));

    const changes = changesOf(baseline, proposed, graph);

    expect(changes).toEqual([
      {
        site: endpointSite('public'),
        difference: {
          kind: 'retired',
          dependencies: [
            { name: 'billing-service', version: '2.1.0' },
            { name: 'billing-service', version: '3.0.0' },
            { name: 'web-app', version: '1.0.0' },
          ],
        },
        class: 'not-allowed',
      },
    ]);
  });

  test('retiring an Event a Dependency subscribes to is not allowed, naming the package', () => {
    const graph: DependencyGraph = [aServiceUsing({ events: [orderPlaced] })];
    const baseline = aBaseline({
      events: { [orderPlaced]: aLive(anEvent(), 'deprecated') },
    });
    const proposed = aProposed({ events: { [orderPlaced]: anEvent({ lifecycle: 'retired' }) } });

    const changes = changesOf(baseline, proposed, graph);

    expect(changes).toEqual([
      {
        site: eventSite('internal'),
        difference: {
          kind: 'retired',
          dependencies: [{ name: 'billing-service', version: '2.1.0' }],
        },
        class: 'not-allowed',
      },
    ]);
  });

  test('retiring an Endpoint no Dependency uses is Breaking and needs an Approval, whatever else the graph holds', () => {
    const graph: DependencyGraph = [
      aServiceUsing({ endpoints: [{ id: 'POST /orders', name: 'createOrder' }] }),
    ];
    const baseline = aBaseline(publishedEndpointAt('public', 'deprecated'));
    const proposed = aProposed(endpointAt('public', { lifecycle: 'retired' }));

    const changes = changesOf(baseline, proposed, graph);

    expect(changes).toEqual([
      {
        site: endpointSite('public'),
        difference: { kind: 'retired', dependencies: [] },
        class: 'breaking',
        approval: 'needed',
      },
    ]);
  });
});

describe('compatibilityReportOf, the dependency graph, narrowing', () => {
  test('narrowing an Endpoint from Public to Internal is not allowed while an Application depends on it', () => {
    const graph: DependencyGraph = [anApplicationUsing({ endpoints: [getOrder] })];
    const baseline = aBaseline(publishedEndpointAt('public'));
    const proposed = aProposed(endpointAt('internal'));

    const changes = changesOf(baseline, proposed, graph);

    expect(changes).toEqual([
      {
        site: endpointSite('public'),
        difference: {
          kind: 'visibility-narrowed',
          from: 'public',
          to: 'internal',
          dependencies: [{ name: 'web-app', version: '1.0.0' }],
        },
        class: 'not-allowed',
      },
    ]);
  });

  test('narrowing an Endpoint from Public to Internal with only Services depending on it is Breaking and needs an Approval', () => {
    const graph: DependencyGraph = [aServiceUsing({ endpoints: [getOrder] })];
    const baseline = aBaseline(publishedEndpointAt('public'));
    const proposed = aProposed(endpointAt('internal'));

    const changes = changesOf(baseline, proposed, graph);

    expect(changes).toEqual([
      {
        site: endpointSite('public'),
        difference: {
          kind: 'visibility-narrowed',
          from: 'public',
          to: 'internal',
          dependencies: [],
        },
        class: 'breaking',
        approval: 'needed',
      },
    ]);
  });

  test.each([
    { who: 'a Service', from: 'public', depending: aServiceUsing({ endpoints: [getOrder] }) },
    { who: 'a Service', from: 'internal', depending: aServiceUsing({ endpoints: [getOrder] }) },
    {
      who: 'an Application',
      from: 'public',
      depending: anApplicationUsing({ endpoints: [getOrder] }),
    },
    {
      who: 'an Application',
      from: 'internal',
      depending: anApplicationUsing({ endpoints: [getOrder] }),
    },
  ] as const)(
    'narrowing an Endpoint from $from to Private is not allowed while $who depends on it',
    ({ from, depending }) => {
      const baseline = aBaseline(publishedEndpointAt(from));
      const proposed = aProposed(endpointAt('private'));

      const changes = changesOf(baseline, proposed, [depending]);

      expect(changes).toEqual([
        {
          site: endpointSite(from),
          difference: {
            kind: 'visibility-narrowed',
            from,
            to: 'private',
            dependencies: [{ name: depending.name, version: depending.version }],
          },
          class: 'not-allowed',
        },
      ]);
    },
  );

  test('narrowing an Event from Internal to Private is not allowed while a Service subscribes to it', () => {
    const graph: DependencyGraph = [aServiceUsing({ events: [orderPlaced] })];
    const baseline = aBaseline({ events: { [orderPlaced]: aLive(anEvent()) } });
    const proposed = aProposed({ events: { [orderPlaced]: anEvent({ visibility: 'private' }) } });

    const changes = changesOf(baseline, proposed, graph);

    expect(changes).toEqual([
      {
        site: eventSite('internal'),
        difference: {
          kind: 'visibility-narrowed',
          from: 'internal',
          to: 'private',
          dependencies: [{ name: 'billing-service', version: '2.1.0' }],
        },
        class: 'not-allowed',
      },
    ]);
  });

  test('a narrowing lists only the Dependencies that lose reach', () => {
    const graph: DependencyGraph = [
      aServiceUsing({ endpoints: [getOrder] }),
      anApplicationUsing({ endpoints: [getOrder] }),
    ];
    const baseline = aBaseline(publishedEndpointAt('public'));
    const proposed = aProposed(endpointAt('internal'));

    const changes = changesOf(baseline, proposed, graph);

    expect(changes.map(({ difference }) => difference)).toEqual([
      {
        kind: 'visibility-narrowed',
        from: 'public',
        to: 'internal',
        dependencies: [{ name: 'web-app', version: '1.0.0' }],
      },
    ]);
  });

  test('a Dependency on another Service’s Element of the same identity blocks no narrowing', () => {
    const graph: DependencyGraph = [
      aGraphPackage({
        kind: 'application',
        dependencies: {
          'payments-service': { against: '1.0.0', endpoints: [getOrder], events: [] },
        },
      }),
    ];
    const baseline = aBaseline(publishedEndpointAt('public'));
    const proposed = aProposed(endpointAt('private'));

    const changes = changesOf(baseline, proposed, graph);

    expect(changes.map(({ class: changeClass }) => changeClass)).toEqual(['breaking']);
  });

  test('renaming an Endpoint a Dependency uses stays Breaking: the graph lists it but does not block it', () => {
    const graph: DependencyGraph = [aServiceUsing({ endpoints: [getOrder] })];
    const baseline = aBaseline(publishedEndpointAt('public'));
    const proposed = aProposed(endpointAt('public', { name: 'fetchOrder' }));

    const changes = changesOf(baseline, proposed, graph);

    expect(changes).toEqual([
      {
        site: endpointSite('public'),
        difference: {
          kind: 'renamed',
          from: 'getOrder',
          to: 'fetchOrder',
          visibility: 'public',
          dependencies: [{ name: 'billing-service', version: '2.1.0' }],
        },
        class: 'breaking',
        approval: 'needed',
      },
    ]);
  });
});
