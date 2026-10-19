import {
  defineContract,
  defineEndpoint,
  defineGroup,
  defineGuard,
  notFound,
} from '@casitafeliz/loom-contract';
import { admit, fault, handle, reject, success } from '@casitafeliz/loom-handlers';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { z } from 'zod';
import { type AnsweredRequest, type ServiceFault, serve } from './index.ts';

const apiKey = defineGuard({
  name: 'apiKey',
  description: 'A key per client',
  context: z.object({ clientId: z.string() }),
});

const getOrder = defineEndpoint({
  name: 'getOrder',
  method: 'GET',
  path: '/orders/:orderId',
  visibility: 'public',
  description: 'One order',
  lifecycle: 'deprecated',
  guards: [apiKey],
  input: { params: z.object({ orderId: z.string() }) },
  success: { status: 200, body: z.object({ secret: z.string().min(10) }) },
  rejections: [notFound],
});

const listOrders = defineEndpoint({
  name: 'listOrders',
  method: 'GET',
  path: '/orders',
  visibility: 'public',
  description: 'Every order',
  success: { status: 200, body: z.object({ count: z.int() }) },
});

const archive = defineEndpoint({
  name: 'archive',
  method: 'POST',
  path: '/archive',
  visibility: 'public',
  description: 'Archives the orders',
  lifecycle: 'retired',
  success: { status: 204 },
});

const contract = defineContract({
  name: 'orders-service',
  groups: [
    defineGroup({
      name: 'orders',
      description: 'Orders',
      endpoints: [getOrder, listOrders, archive],
    }),
  ],
});

const deprecatedAt = { getOrder: '2026-10-17T09:30:00Z', listOrders: '2020-01-01T00:00:00Z' };

/** The Handlers, `getOrder` answering by its param: a Success, a Rejection, a Fault or a broken body. */
const handlers = {
  endpoints: {
    getOrder: handle(getOrder, ({ params }) => {
      switch (params.orderId) {
        case 'missing':
          return reject(notFound);
        case 'down':
          return fault({ committed: 'no', retryable: true });
        case 'leaky':
          return success({ secret: 'short' });
        case 'thrown':
          throw new Error('a bug');
        default:
          return success({ secret: 'a long enough secret' });
      }
    }),
    listOrders: handle(listOrders, () => success({ count: 1 })),
  },
  guards: { apiKey: handle(apiKey, () => admit({ clientId: 'c-1' })) },
  deprecatedAt,
};

afterEach(() => {
  vi.restoreAllMocks();
});

function get(path: string): Request {
  return new Request(`http://test${path}`);
}

describe('serve: onServiceFault', () => {
  test('without it, the console receives each issue’s part, path and code, never the received value', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await serve(contract, handlers)(get('/orders/leaky'));

    expect(logged).toHaveBeenCalledTimes(1);
    const line = String(logged.mock.calls[0]?.[0]);
    expect(line).toMatch(/^getOrder: success\.body\.secret too_small: /);
    expect(line).not.toContain('short');
  });

  test('without it, the console receives a thrown error with its message and cause', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await serve(contract, handlers)(get('/orders/thrown'));

    expect(logged).toHaveBeenCalledWith('getOrder: Internal error', new Error('a bug'));
  });

  test('the Caller’s Faults never reach it', async () => {
    const faults: ServiceFault[] = [];
    const http = serve(contract, handlers, { onServiceFault: (served) => faults.push(served) });

    await http(get('/customers'));
    await http(new Request('http://test/archive', { method: 'POST' }));

    expect(faults).toEqual([]);
  });

  test('what it throws propagates, as the Service’s own bug', async () => {
    const broken = new Error('the hook broke');
    const http = serve(contract, handlers, {
      onServiceFault: () => {
        throw broken;
      },
    });

    const answered = http(get('/orders/down'));

    await expect(answered).rejects.toBe(broken);
  });
});

describe('serve: onOutcome', () => {
  test('receives the Endpoint, status, kind and duration of every request, no Endpoint when none matched', async () => {
    const answered: AnsweredRequest[] = [];
    const http = serve(contract, handlers, {
      onServiceFault: () => undefined,
      onOutcome: (request) => answered.push(request),
    });

    for (const path of ['/orders/o-1', '/orders/missing', '/orders/down', '/customers']) {
      await http(get(path));
    }

    expect(answered).toEqual([
      { endpoint: 'getOrder', status: 200, kind: 'success', durationMs: expect.any(Number) },
      { endpoint: 'getOrder', status: 404, kind: 'rejection', durationMs: expect.any(Number) },
      { endpoint: 'getOrder', status: 503, kind: 'fault', durationMs: expect.any(Number) },
      { status: 404, kind: 'fault', durationMs: expect.any(Number) },
    ]);
    expect(answered.every(({ durationMs }) => durationMs >= 0)).toBe(true);
  });
});

describe('serve: the Deprecation header', () => {
  test('every response of a Deprecated Endpoint carries its deprecatedAt', async () => {
    const http = serve(contract, handlers, { onServiceFault: () => undefined });

    const responses = await Promise.all(
      ['/orders/o-1', '/orders/missing', '/orders/down'].map((path) => http(get(path))),
    );

    expect(responses.map((response) => response.headers.get('deprecation'))).toEqual(
      Array(3).fill('@1792229400'),
    );
  });

  test('an Active Endpoint’s response carries none, whatever stamp the map holds', async () => {
    const response = await serve(contract, handlers)(get('/orders'));

    expect(response.headers.get('deprecation')).toBeNull();
  });
});
