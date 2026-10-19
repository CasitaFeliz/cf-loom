import {
  type ContractPackage,
  defineDependencies,
  defineEndpoint,
} from '@casitafeliz/loom-contract';
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

const orders = {
  name: 'orders-service',
  version: '1.0.0',
  endpoints: { getOrder, cancelOrder, headOrder },
  events: {},
  standardRejections: {
    invalidInput: { code: 'INVALID_INPUT', status: 400, message: 'Invalid input' },
    notFound: { code: 'NOT_FOUND', status: 404, message: 'Not found' },
    notImplemented: { code: 'NOT_IMPLEMENTED', status: 501, message: 'Not implemented' },
  },
} as const satisfies ContractPackage;

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

    expect(outcome).toMatchObject({ kind: 'success', value: { id: 'o-1', total: 3 } });
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
