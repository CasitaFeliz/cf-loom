import {
  defineContract,
  defineEndpoint,
  defineGroup,
  defineGuard,
  notFound,
} from '@cf-loom/contract';
import { admit, handle, reject, success, type WithResources } from '@cf-loom/handlers';
import { describe, expect, expectTypeOf, test } from 'vitest';
import { z } from 'zod';
import { type Http, serve } from './index.ts';

const ORDER_ID = '7f1c3a52-1b2c-4d3e-8f4a-5b6c7d8e9f00';

const apiKey = defineGuard({
  name: 'apiKey',
  description: 'An API key per Caller',
  demands: { headers: z.object({ 'x-api-key': z.string() }) },
  context: z.object({ callerId: z.string() }),
});

const getOrder = defineEndpoint({
  name: 'getOrder',
  method: 'GET',
  path: '/orders/:orderId',
  visibility: 'public',
  description: 'One order by id',
  guards: [apiKey],
  input: { params: z.object({ orderId: z.uuid() }) },
  success: { status: 200, body: z.object({ id: z.uuid(), callerId: z.string() }) },
  rejections: [notFound],
});

const contract = defineContract({
  name: 'orders-service',
  groups: [defineGroup({ name: 'orders', description: 'Orders', endpoints: [getOrder] })],
});

type Resources = { readonly orders: { readonly nameOf: (orderId: string) => string } };

/** The Handler map as `cf-loom generate` writes it, with a GuardHandler that refuses every key. */
const handlers = {
  endpoints: {
    getOrder: handle(
      getOrder,
      ({ params }, context, { resources: { orders } }: WithResources<Resources>) =>
        success({ id: orders.nameOf(params.orderId), callerId: context.apiKey.callerId }),
    ),
  },
  guards: { apiKey: handle(apiKey, () => reject(notFound) as never) },
  commands: {},
  subscriptions: {},
  deprecatedAt: {},
};

const resources: Resources = { orders: { nameOf: (orderId) => orderId } };

describe('the READMEs', () => {
  test('a test replaces one Handler by spreading the map', async () => {
    const http = serve(
      contract,
      {
        ...handlers,
        guards: {
          ...handlers.guards,
          apiKey: handle(apiKey, async () => admit({ callerId: 'c-1' })),
        },
      },
      { resources },
    );
    const res = await http(
      new Request(`http://test/orders/${ORDER_ID}`, {
        headers: { 'x-api-key': 'any' },
      }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: ORDER_ID, callerId: 'c-1' });
  });

  test('serve takes the generated map and its options, and returns the web-standard handler', () => {
    const http = serve(contract, handlers, {
      resources,
      maxBodyBytes: 1_000_000,
      onServiceFault: (fault) => expectTypeOf(fault.endpoint).toEqualTypeOf<string>(),
      onOutcome: ({ endpoint, status, kind, durationMs }) => [endpoint, status, kind, durationMs],
    });

    expectTypeOf(http).toEqualTypeOf<Http>();
    expectTypeOf(http).toEqualTypeOf<(request: Request) => Promise<Response>>();
    expect(typeof http).toBe('function');
  });
});
