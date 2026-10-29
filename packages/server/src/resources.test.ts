import {
  defineCommand,
  defineEndpoint,
  defineGroup,
  defineGuard,
  defineRejection,
  defineService,
  notFound,
} from '@cf-loom/contract';
import { admit, handle, readersOf, reject, success, type WithResources } from '@cf-loom/handlers';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { serve } from './index.ts';

const ORDER_ID = '7f1c3a52-1b2c-4d3e-8f4a-5b6c7d8e9f00';

type Orders = { readonly find: (orderId: string) => string | undefined };
type Callers = { readonly byKey: (key: string) => string | undefined };
type Charges = { readonly chargeOnce: (orderId: string) => void };
type Resources = {
  readonly orders: Orders;
  readonly callers: Callers;
  readonly charges: Charges;
};
type Needs<Key extends keyof Resources> = WithResources<Pick<Resources, Key>>;

const unauthenticated = defineRejection({
  code: 'UNAUTHENTICATED',
  status: 401,
  message: 'Unauthenticated',
});

const apiKey = defineGuard({
  name: 'apiKey',
  description: 'An API key per Caller',
  demands: { headers: z.object({ 'x-api-key': z.string() }) },
  context: z.object({ callerId: z.string() }),
  rejections: [unauthenticated],
});

const getOrder = defineEndpoint({
  name: 'getOrder',
  method: 'GET',
  path: '/orders/:orderId',
  visibility: 'public',
  description: 'One order by id',
  guards: [apiKey],
  input: { params: z.object({ orderId: z.uuid() }) },
  success: { status: 200, body: z.object({ name: z.string(), callerId: z.string() }) },
  rejections: [notFound],
});

const health = defineEndpoint({
  name: 'health',
  method: 'GET',
  path: '/health',
  visibility: 'public',
  description: 'Whether the Service is up',
  success: { status: 204 },
});

const chargeCardV1 = defineCommand({
  name: 'ChargeCard',
  version: 1,
  description: 'Charges the order’s card',
  body: z.object({ orderId: z.uuid() }),
});

const contract = defineService({
  name: 'orders-service',
  groups: [defineGroup({ name: 'orders', description: 'Orders', endpoints: [getOrder, health] })],
});

const orders: Orders = { find: (orderId) => (orderId === ORDER_ID ? 'Book' : undefined) };
const callers: Callers = { byKey: (key) => (key === 'key-1' ? 'c-1' : undefined) };
const charges: Charges = { chargeOnce: () => undefined };
const resources: Resources = { orders, callers, charges };

const seen: unknown[] = [];

const getOrderHandler = handle(
  getOrder,
  ({ params }, { context }, { resources: taken }: Needs<'orders'>) => {
    seen.push(taken);
    const name = taken.orders.find(params.orderId);
    return name === undefined
      ? reject(notFound)
      : success(getOrder, { name, callerId: context.apiKey.callerId });
  },
);

const apiKeyHandler = handle(
  apiKey,
  ({ headers }, _call, { resources: taken }: Needs<'callers'>) => {
    seen.push(taken);
    const callerId = taken.callers.byKey(headers['x-api-key']);
    return callerId === undefined ? reject(unauthenticated) : admit(apiKey, { callerId });
  },
);

const readers = readersOf({
  commands: { chargeCardV1: { declaration: chargeCardV1, reader: chargeCardV1.body } },
  subscriptions: {},
});

const chargeCardHandler = handle(
  readers.commands.chargeCardV1,
  (_body, _meta, { resources: taken }: Needs<'charges'>) => {
    taken.charges.chargeOnce(ORDER_ID);
  },
);

const healthHandler = handle(health, () => success(health));

const handlers = {
  endpoints: { getOrder: getOrderHandler, health: healthHandler },
  guards: { apiKey: apiKeyHandler },
  commands: { chargeCardV1: chargeCardHandler },
  subscriptions: {},
  readers,
};

function getOrderRequest(key: string): Request {
  return new Request(`http://test/orders/${ORDER_ID}`, { headers: { 'x-api-key': key } });
}

describe('serve: Resources', () => {
  test('hands its Resources to the EndpointHandler of every request', async () => {
    const http = serve(contract, handlers, { resources });

    const response = await http(getOrderRequest('key-1'));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ name: 'Book', callerId: 'c-1' });
  });

  test('hands its Resources to every GuardHandler an Endpoint attaches', async () => {
    const http = serve(contract, handlers, { resources });

    const response = await http(getOrderRequest('unknown'));

    expect(response.status).toBe(401);
  });

  test('every Handler receives the very object serve was given', async () => {
    seen.length = 0;
    const http = serve(contract, handlers, { resources });

    await http(getOrderRequest('key-1'));

    expect(seen).toHaveLength(2);
    expect(seen[0]).toBe(resources);
    expect(seen[1]).toBe(resources);
  });

  test('without the Resources its Endpoint and Guard Handlers take is a type error', () => {
    const missing = () => [
      // @ts-expect-error the Handlers take orders and callers
      serve(contract, handlers, {}),
      // @ts-expect-error the options must hold the Resources
      serve(contract, handlers, { maxBodyBytes: 1 }),
      // @ts-expect-error callers is missing
      serve(contract, handlers, { resources: { orders } }),
      // @ts-expect-error orders is missing
      serve(contract, handlers, { resources: { callers } }),
    ];

    expect(missing).toBeDefined();
  });

  test('does not ask for the Resources a Message Handler takes', () => {
    const served = { orders, callers };

    const http = serve(contract, handlers, { resources: served });

    expect(http).toBeTypeOf('function');
  });

  test('takes no options when no Handler of the map takes Resources', () => {
    const bare = {
      endpoints: { getOrder: handle.stub(getOrder), health: healthHandler },
      guards: { apiKey: handle(apiKey, () => admit(apiKey, { callerId: 'c-1' })) },
    };

    const served = [serve(contract, bare, {}), serve(contract, bare, { maxBodyBytes: 1 })];

    expect(served).toHaveLength(2);
  });

  test('a map of stubs is served with Resources given', () => {
    const stubs = {
      endpoints: { getOrder: handle.stub(getOrder), health: handle.stub(health) },
      guards: { apiKey: handle.stub(apiKey) },
    };

    const http = serve(contract, stubs, { resources: { orders } });

    expect(http).toBeTypeOf('function');
  });

  test('a test that replaces a Handler by spreading the map needs only what the rest take', async () => {
    const replaced = {
      ...handlers,
      guards: { apiKey: handle(apiKey, () => admit(apiKey, { callerId: 'c-9' })) },
    };
    const needed = { orders };
    const http = serve(contract, replaced, { resources: needed });

    const response = await http(getOrderRequest('any'));

    expect(await response.json()).toEqual({ name: 'Book', callerId: 'c-9' });
  });
});

describe('serve: the request an EndpointHandler receives', () => {
  test('an EndpointHandler receives the request’s headers as received, x-request-id included', async () => {
    const received: Headers[] = [];
    const healthy = handle(health, (_input, { request }) => {
      received.push(request.headers);
      return success(health);
    });
    const http = serve(
      contract,
      { ...handlers, endpoints: { ...handlers.endpoints, health: healthy } },
      {
        resources,
      },
    );

    await http(new Request('http://test/health', { headers: { 'x-request-id': 'r-1' } }));

    expect(received[0]?.get('x-request-id')).toBe('r-1');
  });

  test('an EndpointHandler receives the request’s abort signal, which aborts when the Request’s does', async () => {
    const controller = new AbortController();
    const received: AbortSignal[] = [];
    const healthy = handle(health, (_input, { request }) => {
      received.push(request.signal);
      controller.abort();
      return success(health);
    });
    const http = serve(
      contract,
      { ...handlers, endpoints: { ...handlers.endpoints, health: healthy } },
      {
        resources,
      },
    );

    await http(new Request('http://test/health', { signal: controller.signal }));

    expect(received[0]?.aborted).toBe(true);
  });
});
