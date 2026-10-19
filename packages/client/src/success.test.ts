import {
  type ContractPackage,
  defineContract,
  defineDependencies,
  defineEndpoint,
  defineGroup,
  type Endpoint,
  openEnum,
  type StandardRejections,
} from '@casitafeliz/loom-contract';
import { snapshotOf, validateContract } from '@casitafeliz/loom-contract/internal';
import { describe, expect, expectTypeOf, test } from 'vitest';
import { z } from 'zod';
import { client } from './index.ts';

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

const headOrder = defineEndpoint({
  name: 'headOrder',
  method: 'HEAD',
  path: '/orders/:orderId',
  visibility: 'public',
  description: 'Whether an order exists',
  input: { params: z.object({ orderId: z.string() }) },
  success: { status: 200, headers: z.object({ 'x-total': z.int() }) },
});

/**
 * The Provider's Contract Package as `cf-loom package` writes it: its Endpoints, its resolved
 * Standard Rejections, and the Snapshot its declarations give, cut to what it exports.
 */
function contractPackageOf<
  const Endpoints extends ContractPackage['endpoints'],
  const Standards extends StandardRejections,
>(endpoints: Endpoints, standardRejections: Standards, declared = Object.values(endpoints)) {
  const listed = declared as unknown as [Endpoint];
  const group = defineGroup({ name: 'orders', description: 'Orders', endpoints: listed });
  const root = defineContract({ name: 'orders-service', groups: [group] });
  const rootPackage = {
    packageName: 'orders-service',
    originOf: () => undefined,
    exportsOf: () => [],
  };
  const validated = validateContract(root, rootPackage);
  if (validated.kind !== 'valid') {
    throw new Error(`The fixture is invalid: ${JSON.stringify(validated.failures)}`);
  }
  const context = { generator: 'test', packages: [], committed: undefined, now: 0 };
  const snapshot = snapshotOf(validated, context);
  if (snapshot.kind !== 'service') {
    throw new Error('The fixture is no Service');
  }
  const { format, defs, guards, codes } = snapshot;
  const exportedSnapshot = { format, defs, endpoints: snapshot.endpoints, guards, codes };
  const name = 'orders-service';
  return { name, version: '1.0.0', endpoints, events: {}, standardRejections, exportedSnapshot };
}

const defaultStandards = {
  invalidInput: { code: 'INVALID_INPUT', status: 400, message: 'Invalid input' },
  notFound: { code: 'NOT_FOUND', status: 404, message: 'Not found' },
  notImplemented: { code: 'NOT_IMPLEMENTED', status: 501, message: 'Not implemented' },
} as const;

const orders = contractPackageOf({ getOrder, cancelOrder, headOrder }, defaultStandards);

const ordersDeps = defineDependencies(orders, {
  endpoints: [getOrder, cancelOrder, headOrder],
});

const params = { params: { orderId: 'o-1' } };

function ordersAnswering(response: () => Response) {
  return client(ordersDeps, { baseUrl: 'http://orders.test', fetch: async () => response() });
}

describe('a Success', () => {
  test('carries its body as value and its declared headers, read as their types', async () => {
    const headers = { 'x-total': '3', 'x-cached': 'true', 'x-other': 'passes through' };
    const orders = ordersAnswering(() => Response.json({ id: 'o-1', total: 3 }, { headers }));

    const outcome = await orders.getOrder(params);

    expect(outcome).toEqual({
      kind: 'success',
      value: { id: 'o-1', total: 3 },
      headers: { 'x-total': 3, 'x-cached': true },
    });
    if (outcome.kind === 'success') {
      expectTypeOf(outcome.value).toEqualTypeOf<{ id: string; total: number }>();
      expectTypeOf(outcome.headers['x-total']).toEqualTypeOf<number>();
    }
  });

  test('ignores fields its Reader schema does not know', async () => {
    const body = { id: 'o-1', total: 3, addedLater: { by: 'a newer Provider' } };
    const orders = ordersAnswering(() => Response.json(body, { headers: { 'x-total': '3' } }));

    const outcome = await orders.getOrder(params);

    expect(outcome).toEqual({
      kind: 'success',
      value: { id: 'o-1', total: 3 },
      headers: { 'x-total': 3 },
    });
  });

  test('a 204 carries no value and no headers', async () => {
    const orders = ordersAnswering(() => new Response(null, { status: 204 }));

    const outcome = await orders.cancelOrder(params);

    expect(outcome).toEqual({ kind: 'success', value: undefined, headers: {} });
  });

  test('a HEAD Success carries its headers only', async () => {
    const orders = ordersAnswering(() => new Response(null, { headers: { 'x-total': '7' } }));

    const outcome = await orders.headOrder(params);

    expect(outcome).toEqual({ kind: 'success', value: undefined, headers: { 'x-total': 7 } });
  });
});

describe('a Success that breaks its Reader schemas', () => {
  test('a body that fails is INVALID_OUTCOME, committed yes, with Issues and never the value', async () => {
    const body = { id: 'o-1', total: -5 };
    const orders = ordersAnswering(() => Response.json(body, { headers: { 'x-total': '3' } }));

    const outcome = await orders.getOrder(params);

    expect(outcome).toEqual({
      kind: 'fault',
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
        code: 'INVALID_OUTCOME',
        committed: 'yes',
        issues: [{ part: 'success.headers', path: ['x-total'], code: 'invalid_type' }],
      },
      {
        code: 'INVALID_OUTCOME',
        committed: 'yes',
        issues: [{ part: 'success.headers', path: ['x-total'], code: 'required' }],
      },
    ]);
  });

  test('a body that is no JSON, as a proxy’s page on the Success status, is INVALID_OUTCOME', async () => {
    const page = new Response('<html>OK</html>', {
      headers: { 'content-type': 'text/html', 'x-total': '1' },
    });
    const garbled = new Response('{"id":', {
      headers: { 'content-type': 'application/json', 'x-total': '1' },
    });

    const outcomes = [
      await ordersAnswering(() => page).getOrder(params),
      await ordersAnswering(() => garbled).getOrder(params),
    ];

    expect(outcomes).toMatchObject([
      {
        code: 'INVALID_OUTCOME',
        committed: 'yes',
        issues: [{ part: 'success.body', code: 'malformed' }],
      },
      {
        code: 'INVALID_OUTCOME',
        committed: 'yes',
        issues: [{ part: 'success.body', code: 'malformed' }],
      },
    ]);
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
  const trackOrderReader = defineEndpoint({
    name: 'trackOrder',
    method: 'GET',
    path: '/orders/:orderId/track',
    visibility: 'public',
    description: 'Where an order stands',
    input: { params: z.object({ orderId: z.string() }) },
    success: {
      status: 204,
      headers: z.object({
        'x-stage': z.union([
          z.enum(['packed', 'shipped']),
          z.string().transform((unknown) => ({ unknown })),
        ]),
      }),
    },
  });
  const tracking = contractPackageOf({ trackOrder: trackOrderReader }, defaultStandards, [
    trackOrder,
  ]);
  const trackingDeps = defineDependencies(tracking, { endpoints: [trackOrderReader] });

  function trackingAnswering(stage: string) {
    const response = () => new Response(null, { status: 204, headers: { 'x-stage': stage } });
    return client(trackingDeps, { baseUrl: 'http://orders.test', fetch: async () => response() });
  }

  test('a declared value is read as itself, and one it does not know as its Unknown case', async () => {
    const outcomes = [
      await trackingAnswering('shipped').trackOrder(params),
      await trackingAnswering('lost').trackOrder(params),
    ];

    expect(outcomes).toEqual([
      { kind: 'success', value: undefined, headers: { 'x-stage': 'shipped' } },
      { kind: 'success', value: undefined, headers: { 'x-stage': { unknown: 'lost' } } },
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
    const stageOrderReader = defineEndpoint({
      name: 'stageOrder',
      method: 'GET',
      path: '/orders/:orderId/stage',
      visibility: 'public',
      description: 'The stage of an order',
      input: { params: z.object({ orderId: z.string() }) },
      success: {
        status: 200,
        body: z.object({
          stage: z.union([
            z.enum(['packed', 'shipped']),
            z.string().transform((unknown) => ({ unknown })),
          ]),
        }),
      },
    });
    const staging = contractPackageOf({ stageOrder: stageOrderReader }, defaultStandards, [
      stageOrder,
    ]);
    const stagingDeps = defineDependencies(staging, { endpoints: [stageOrderReader] });
    const stages = client(stagingDeps, {
      baseUrl: 'http://orders.test',
      fetch: async () => Response.json({ stage: 'lost' }),
    });

    const outcome = await stages.stageOrder(params);

    expect(outcome).toEqual({
      kind: 'success',
      value: { stage: { unknown: 'lost' } },
      headers: {},
    });
  });
});
