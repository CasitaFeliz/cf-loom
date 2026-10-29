import {
  defineDependency,
  defineEndpoint,
  defineGroup,
  defineService,
  type Endpoint,
  openEnum,
  openEnumReader,
  type ProvidedStandardRejections,
  providedEndpoint,
} from '@cf-loom/contract';
import { snapshotOf, validateRoot } from '@cf-loom/contract/internal';
import { describe, expect, expectTypeOf, test } from 'vitest';
import { z } from 'zod';
import { type Exportable, providedEndpointsOf } from '../test/provided.ts';
import { aRootPackage } from '../test/root-package.ts';
import { providedStandardRejections } from '../test/standard-rejections.ts';
import { client, type Happened } from './index.ts';

const getOrder = defineEndpoint({
  name: 'getOrder',
  method: 'GET',
  path: '/orders/:orderId',
  visibility: 'public',
  description: 'One order',
  input: { params: z.object({ orderId: z.string() }) },
  success: {
    status: 200,
    headers: z.object({ 'x-total': z.int(), 'x-cached': z.boolean().optional() }),
    body: z.object({ id: z.string(), total: z.int().min(0) }),
  },
});

const cancelOrder = defineEndpoint({
  name: 'cancelOrder',
  method: 'DELETE',
  path: '/orders/:orderId',
  visibility: 'public',
  description: 'Cancels an order',
  input: { params: z.object({ orderId: z.string() }) },
  success: { status: 204 },
});

const orderTotal = defineEndpoint({
  name: 'orderTotal',
  method: 'GET',
  path: '/orders/:orderId/total',
  visibility: 'public',
  description: 'The total of an order, in a header',
  input: { params: z.object({ orderId: z.string() }) },
  success: { status: 204, headers: z.object({ 'x-total': z.int() }) },
});

/**
 * The Provider's Contract Package as `cf-loom package` writes it: its Endpoints, its resolved
 * Standard Rejections, and the Snapshot its declarations give, cut to what it exports.
 */
function contractPackageOf<
  const Endpoints extends Readonly<Record<string, Exportable>>,
  const Standards extends ProvidedStandardRejections,
>(endpoints: Endpoints, standardRejections: Standards, declared = Object.values(endpoints)) {
  const listed = declared as unknown as [Endpoint];
  const group = defineGroup({ name: 'orders', description: 'Orders', endpoints: listed });
  const root = defineService({ name: 'orders-service', groups: [group] });
  const rootPackage = aRootPackage(root, { packageName: 'orders-service' });
  const validated = validateRoot(root, rootPackage);
  if (validated.kind !== 'valid') {
    throw new Error(`The fixture is invalid: ${JSON.stringify(validated.failures)}`);
  }
  const snapshot = snapshotOf(validated);
  if (snapshot.kind !== 'service') {
    throw new Error('The fixture is no Service');
  }
  const name = 'orders-service';
  const provided = providedEndpointsOf({ name, standardRejections }, endpoints, snapshot);
  return {
    name,
    endpoints: provided,
    events: {},
    standardRejections,
  };
}

const defaultStandards = providedStandardRejections();

const orders = contractPackageOf({ getOrder, cancelOrder, orderTotal }, defaultStandards);

const ordersDependency = defineDependency({
  endpoints: [orders.endpoints.getOrder, orders.endpoints.cancelOrder, orders.endpoints.orderTotal],
});

const params = { params: { orderId: 'o-1' } };

function ordersAnswering(response: () => Response) {
  return client(ordersDependency, { baseUrl: 'http://orders.test', fetch: async () => response() });
}

describe('a Success', () => {
  test('carries its status, its body and its declared headers, read as their types', async () => {
    const headers = { 'x-total': '3', 'x-cached': 'true', 'x-other': 'passes through' };
    const orders = ordersAnswering(() => Response.json({ id: 'o-1', total: 3 }, { headers }));

    const outcome = await orders.getOrder(params);

    expect(outcome).toEqual({
      kind: 'success',
      status: 200,
      headers: { 'x-total': 3, 'x-cached': true },
      body: { id: 'o-1', total: 3 },
    });
    if (outcome.kind === 'success') {
      expectTypeOf(outcome.status).toEqualTypeOf<200>();
      expectTypeOf(outcome.body).toEqualTypeOf<{ id: string; total: number }>();
      expectTypeOf(outcome.headers['x-total']).toEqualTypeOf<number>();
      // @ts-expect-error TS7053 a header the Endpoint does not declare is not read, so it is not typed
      expectTypeOf(outcome.headers['x-undeclared']).toBeUnknown();
    }
  });

  test('ignores fields its Reader schema does not know', async () => {
    const body = { id: 'o-1', total: 3, addedLater: { by: 'a newer Provider' } };
    const orders = ordersAnswering(() => Response.json(body, { headers: { 'x-total': '3' } }));

    const outcome = await orders.getOrder(params);

    expect(outcome).toEqual({
      kind: 'success',
      status: 200,
      headers: { 'x-total': 3 },
      body: { id: 'o-1', total: 3 },
    });
  });

  test('an Endpoint that declares no body and no headers has neither key', async () => {
    const orders = ordersAnswering(() => new Response(null, { status: 204 }));

    const outcome = await orders.cancelOrder(params);

    expect(outcome).toStrictEqual({ kind: 'success', status: 204 });
  });

  test('an Endpoint that declares headers only has no body key', async () => {
    const headers = { 'x-total': '7' };
    const orders = ordersAnswering(() => new Response(null, { status: 204, headers }));

    const outcome = await orders.orderTotal(params);

    expect(outcome).toStrictEqual({ kind: 'success', status: 204, headers: { 'x-total': 7 } });
  });
});

describe('a Success that breaks its Reader schemas', () => {
  test('a body that fails is INVALID_OUTCOME, committed yes, with Issues and never the value', async () => {
    const body = { id: 'o-1', total: -5 };
    const orders = ordersAnswering(() => Response.json(body, { headers: { 'x-total': '3' } }));

    const outcome = await orders.getOrder(params);

    expect(outcome).toEqual({
      kind: 'fault',
      source: 'invalid-outcome',
      status: 200,
      code: 'INVALID_OUTCOME',
      committed: 'yes',
      retryable: false,
      message: 'The Outcome broke the Contract',
      issues: [
        { part: 'success.body', path: ['total'], code: 'too_small', message: expect.any(String) },
      ],
    });
    expect(JSON.stringify(outcome)).not.toContain('-5');
  });

  test('a header that fails, or is missing, is INVALID_OUTCOME at success.headers', async () => {
    const body = { id: 'o-1', total: 3 };
    const wrong = ordersAnswering(() => Response.json(body, { headers: { 'x-total': 'many' } }));
    const missing = ordersAnswering(() => Response.json(body));

    const outcomes = [await wrong.getOrder(params), await missing.getOrder(params)];

    expect(outcomes).toMatchObject([
      {
        source: 'invalid-outcome',
        code: 'INVALID_OUTCOME',
        committed: 'yes',
        issues: [{ part: 'success.headers', path: ['x-total'], code: 'invalid_type' }],
      },
      {
        source: 'invalid-outcome',
        code: 'INVALID_OUTCOME',
        committed: 'yes',
        issues: [{ part: 'success.headers', path: ['x-total'], code: 'required' }],
      },
    ]);
  });
});

describe('a Success body nested past the stack', () => {
  const tree: z.ZodType = z
    .object({
      get next() {
        return tree.optional();
      },
    })
    .meta({ id: 'tree' });
  const nest = defineEndpoint({
    name: 'nest',
    method: 'GET',
    path: '/nest',
    visibility: 'public',
    description: 'A deep body',
    success: { status: 200, body: tree },
  });
  const nestingPackage = contractPackageOf({ nest }, defaultStandards);
  const nesting = defineDependency({
    endpoints: [nestingPackage.endpoints.nest],
  });

  test('is INVALID_OUTCOME with one malformed Issue at success.body, never a rejected call', async () => {
    const deep = `${'{"next":'.repeat(5000)}{}${'}'.repeat(5000)}`;
    const nests = client(nesting, {
      baseUrl: 'http://orders.test',
      fetch: async () =>
        new Response(deep, { status: 200, headers: { 'content-type': 'application/json' } }),
    });

    const outcome = await nests.nest();

    expect(outcome).toMatchObject({
      kind: 'fault',
      source: 'invalid-outcome',
      code: 'INVALID_OUTCOME',
      committed: 'yes',
      issues: [
        {
          part: 'success.body',
          path: [],
          code: 'malformed',
          message: 'The value is nested too deeply to read',
        },
      ],
    });
  });
});

describe('a Success body of many Issues', () => {
  const listTags = defineEndpoint({
    name: 'listTags',
    method: 'GET',
    path: '/tags',
    visibility: 'public',
    description: 'The tags',
    success: { status: 200, body: z.array(z.string()) },
  });
  const tagsPackage = contractPackageOf({ listTags }, defaultStandards);
  const tagging = defineDependency({ endpoints: [tagsPackage.endpoints.listTags] });

  test('a body whose 300,000 items each break its schema is INVALID_OUTCOME, not a throw', async () => {
    const wide = JSON.stringify(Array.from({ length: 300_000 }, () => 1));
    const tags = client(tagging, {
      baseUrl: 'http://orders.test',
      fetch: async () =>
        new Response(wide, { status: 200, headers: { 'content-type': 'application/json' } }),
    });

    const outcome = await tags.listTags();

    expect(outcome).toMatchObject({
      kind: 'fault',
      source: 'invalid-outcome',
      code: 'INVALID_OUTCOME',
      committed: 'yes',
    });
    const issues = outcome.kind === 'fault' ? (outcome.issues ?? []) : [];
    expect(issues).toHaveLength(300_000);
    expect(issues[299_999]).toMatchObject({ part: 'success.body', path: [299_999] });
  });
});

describe('a Success status that carries no JSON', () => {
  const statusFault = {
    kind: 'fault',
    source: 'status',
    status: 200,
    committed: 'unknown',
    retryable: false,
    message: 'The Provider answered 200',
  };

  test('an HTML body, as a proxy’s page, is the status Fault, offered to inferFault', async () => {
    const page = new Response('<html>OK</html>', {
      headers: { 'content-type': 'text/html', 'x-total': '1' },
    });
    const received: Happened[] = [];
    const orders = client(ordersDependency, {
      baseUrl: 'http://orders.test',
      fetch: async () => page,
      inferFault: (happened) => {
        received.push(happened);
        return undefined;
      },
    });

    const outcome = await orders.getOrder(params);

    expect(outcome).toEqual(statusFault);
    expect(received).toEqual([{ kind: 'status', status: 200, headers: page.headers }]);
  });

  test('bytes that are no JSON under a JSON content type are the same status Fault', async () => {
    const garbled = new Response('{"id":', {
      headers: { 'content-type': 'application/json', 'x-total': '1' },
    });

    const outcome = await ordersAnswering(() => garbled).getOrder(params);

    expect(outcome).toEqual(statusFault);
  });

  test('an HTML body beside a Success header that fails its schema is still the status Fault', async () => {
    const page = new Response('<html>OK</html>', {
      headers: { 'content-type': 'text/html', 'x-total': 'many' },
    });

    const outcome = await ordersAnswering(() => page).getOrder(params);

    expect(outcome).toEqual(statusFault);
  });
});

describe('an Open Enum Success header', () => {
  const trackOrder = defineEndpoint({
    name: 'trackOrder',
    method: 'GET',
    path: '/orders/:orderId/track',
    visibility: 'public',
    description: 'Where an order stands',
    input: { params: z.object({ orderId: z.string() }) },
    success: { status: 204, headers: z.object({ 'x-stage': openEnum(['packed', 'shipped']) }) },
  });
  /** The Endpoint as its Contract Package rebuilds it, its Success headers as Reader schemas. */
  const trackOrderReader = providedEndpoint(
    { name: 'orders-service', standardRejections: defaultStandards },
    {
      name: 'trackOrder',
      method: 'GET',
      path: '/orders/:orderId/track',
      visibility: 'public',
      description: 'Where an order stands',
      input: { params: z.object({ orderId: z.string() }) },
      success: {
        status: 204,
        headers: z.object({
          'x-stage': openEnumReader(['packed', 'shipped']),
        }),
      },
    },
    undefined,
  );
  const tracking = contractPackageOf({ trackOrder: trackOrderReader }, defaultStandards, [
    trackOrder,
  ]);
  const trackingDependency = defineDependency({
    endpoints: [tracking.endpoints.trackOrder],
  });

  function trackingAnswering(stage: string) {
    const response = () => new Response(null, { status: 204, headers: { 'x-stage': stage } });
    return client(trackingDependency, {
      baseUrl: 'http://orders.test',
      fetch: async () => response(),
    });
  }

  test('a declared value is read as itself, and one it does not know as its Unknown case', async () => {
    const outcomes = [
      await trackingAnswering('shipped').trackOrder(params),
      await trackingAnswering('lost').trackOrder(params),
    ];

    expect(outcomes).toEqual([
      { kind: 'success', status: 204, headers: { 'x-stage': 'shipped' } },
      { kind: 'success', status: 204, headers: { 'x-stage': { unknown: 'lost' } } },
    ]);
  });

  test('an Open Enum value it does not know in a Success body is its Unknown case too', async () => {
    const stageOrder = defineEndpoint({
      name: 'stageOrder',
      method: 'GET',
      path: '/orders/:orderId/stage',
      visibility: 'public',
      description: 'The stage of an order',
      input: { params: z.object({ orderId: z.string() }) },
      success: { status: 200, body: z.object({ stage: openEnum(['packed', 'shipped']) }) },
    });
    const stageOrderReader = providedEndpoint(
      { name: 'orders-service', standardRejections: defaultStandards },
      {
        name: 'stageOrder',
        method: 'GET',
        path: '/orders/:orderId/stage',
        visibility: 'public',
        description: 'The stage of an order',
        input: { params: z.object({ orderId: z.string() }) },
        success: {
          status: 200,
          body: z.object({
            stage: openEnumReader(['packed', 'shipped']),
          }),
        },
      },
      undefined,
    );
    const staging = contractPackageOf({ stageOrder: stageOrderReader }, defaultStandards, [
      stageOrder,
    ]);
    const stagingDependency = defineDependency({
      endpoints: [staging.endpoints.stageOrder],
    });
    const stages = client(stagingDependency, {
      baseUrl: 'http://orders.test',
      fetch: async () => Response.json({ stage: 'lost' }),
    });

    const outcome = await stages.stageOrder(params);

    expect(outcome).toEqual({
      kind: 'success',
      status: 200,
      body: { stage: { unknown: 'lost' } },
    });
  });
});
