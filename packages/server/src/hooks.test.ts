import {
  defineContract,
  defineEndpoint,
  defineGroup,
  defineGuard,
  defineRejection,
  notFound,
} from '@cf-loom/contract';
import { admit, fault, handle, reject, success } from '@cf-loom/handlers';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { z } from 'zod';
import { type AnsweredRequest, type ServedFault, serve } from './index.ts';

const unauthenticated = defineRejection({
  code: 'UNAUTHENTICATED',
  status: 401,
  message: 'Unauthenticated',
});

const apiKey = defineGuard({
  name: 'apiKey',
  description: 'A key per Caller',
  context: z.object({ callerId: z.string() }),
  rejections: [unauthenticated],
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

const importOrders = defineEndpoint({
  name: 'importOrders',
  method: 'POST',
  path: '/imports',
  visibility: 'public',
  description: 'Imports orders',
  input: { body: z.object({ orders: z.array(z.string()) }) },
  success: { status: 204 },
});

const contract = defineContract({
  name: 'orders-service',
  groups: [
    defineGroup({
      name: 'orders',
      description: 'Orders',
      endpoints: [getOrder, listOrders, archive, importOrders],
    }),
  ],
});

const deprecatedAt = { getOrder: '2026-10-17T09:30:00Z', listOrders: '2020-01-01T00:00:00Z' };

/** The Handlers, `getOrder` answering by its param: a Success, a Rejection, a Fault or a broken body. */
const handlers = {
  endpoints: {
    getOrder: handle(getOrder, async ({ params }) => {
      switch (params.orderId) {
        case 'slow':
          await new Promise((resolve) => setTimeout(resolve, 40));
          return success({ secret: 'a long enough secret' });
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
    importOrders: handle(importOrders, () => success()),
  },
  guards: { apiKey: handle(apiKey, () => admit({ callerId: 'c-1' })) },
  deprecatedAt,
};

const downFault = { committed: 'no', retryable: true } as const;

afterEach(() => {
  vi.restoreAllMocks();
});

function tooLarge(): Request {
  const body = JSON.stringify({ orders: ['o-1', 'o-2', 'o-3'] });
  const headers = { 'content-type': 'application/json' };
  return new Request('http://test/imports', { method: 'POST', headers, body });
}

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

  test('without it, a throw is logged as the Handler threw, with its cause', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await serve(contract, handlers)(get('/orders/thrown'));

    expect(logged).toHaveBeenCalledWith('getOrder: the Handler threw', new Error('a bug'));
  });

  test('without it, the console names the Guard whose Handler failed', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const broken = handle(apiKey, () => admit({ callerId: 7 } as never));

    await serve(contract, { ...handlers, guards: { apiKey: broken } })(get('/orders/o-1'));

    expect(String(logged.mock.calls[0]?.[0])).toMatch(
      /^getOrder apiKey: context\.callerId invalid_type: /,
    );
  });

  test('without it, the console receives a returned Fault with its message', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await serve(contract, handlers)(get('/orders/down'));

    expect(logged).toHaveBeenCalledWith('getOrder: Internal error');
  });

  test('with it, the console receives nothing', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const faults: ServedFault[] = [];

    await serve(contract, handlers, {
      onServiceFault: (served) => {
        faults.push(served);
      },
    })(get('/orders/thrown'));

    expect(faults).toHaveLength(1);
    expect(logged).not.toHaveBeenCalled();
  });

  test('the Caller’s Faults never reach it', async () => {
    const faults: ServedFault[] = [];
    const http = serve(contract, handlers, {
      maxBodyBytes: 8,
      onServiceFault: (served) => {
        faults.push(served);
      },
    });

    await http(get('/customers'));
    await http(new Request('http://test/archive', { method: 'POST' }));
    await http(tooLarge());

    expect(faults).toEqual([]);
  });

  test('a Handler’s throw reaches it as thrown, with the Endpoint, its name and the error as cause', async () => {
    const faults: ServedFault[] = [];

    await serve(contract, handlers, {
      onServiceFault: (served) => {
        faults.push(served);
      },
    })(get('/orders/thrown'));

    expect(faults).toStrictEqual([
      { element: getOrder, identity: 'getOrder', kind: 'thrown', cause: new Error('a bug') },
    ]);
  });

  test('a Guard’s throw reaches it with the Endpoint, its name and the Guard', async () => {
    const faults: ServedFault[] = [];
    const throwing = handle(apiKey, () => {
      throw new Error('the Guard broke');
    });
    const guarded = { ...handlers, guards: { apiKey: throwing } };

    await serve(contract, guarded, {
      onServiceFault: (served) => {
        faults.push(served);
      },
    })(get('/orders/o-1'));

    expect(faults).toStrictEqual([
      {
        element: getOrder,
        identity: 'getOrder',
        guard: apiKey,
        kind: 'thrown',
        cause: new Error('the Guard broke'),
      },
    ]);
  });
});

describe('serve: a hook that fails', () => {
  const broken = new Error('the hook broke');
  const throwing = () => {
    throw broken;
  };
  const rejecting = async () => {
    throw broken;
  };

  test('an onServiceFault that throws leaves the answer as computed', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const response = await serve(contract, handlers, { onServiceFault: throwing })(
      get('/orders/thrown'),
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      fault: { committed: 'unknown', retryable: false, message: 'Internal error' },
    });
  });

  test('an onServiceFault that throws is logged with what it threw as cause', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await serve(contract, handlers, { onServiceFault: throwing })(get('/orders/down'));

    expect(logged).toHaveBeenCalledWith('getOrder: onServiceFault threw', broken);
  });

  test('an onServiceFault of a Guard’s Fault that throws is logged naming the Guard', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const guarded = { ...handlers, guards: { apiKey: handle(apiKey, () => fault(downFault)) } };

    await serve(contract, guarded, { onServiceFault: throwing })(get('/orders/o-1'));

    expect(logged).toHaveBeenCalledWith('getOrder apiKey: onServiceFault threw', broken);
  });

  test('an onServiceFault that rejects is awaited and logged, and the Http resolves', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const response = await serve(contract, handlers, { onServiceFault: rejecting })(
      get('/orders/down'),
    );

    expect(response.status).toBe(503);
    expect(logged).toHaveBeenCalledWith('getOrder: onServiceFault threw', broken);
  });

  test('onOutcome still receives the record when onServiceFault throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const answered: AnsweredRequest[] = [];
    const http = serve(contract, handlers, {
      onServiceFault: throwing,
      onOutcome: (request) => {
        answered.push(request);
      },
    });

    await http(get('/orders/down'));

    expect(answered.map(({ status }) => status)).toEqual([503]);
  });

  test.each([
    ['throws', throwing],
    ['rejects', rejecting],
  ])('an onOutcome that %s leaves the response returned, and is logged', async (_, onOutcome) => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const response = await serve(contract, handlers, { onOutcome })(get('/orders/o-1'));

    expect(response.status).toBe(200);
    expect(logged).toHaveBeenCalledWith('getOrder: onOutcome threw', broken);
  });

  test('an onOutcome that throws for a request no Endpoint matched is logged as serve’s', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await serve(contract, handlers, { onOutcome: throwing })(get('/customers'));

    expect(logged).toHaveBeenCalledWith('serve: onOutcome threw', broken);
  });

  test('serve waits for an async onServiceFault before it resolves', async () => {
    let heard = false;
    const onServiceFault = async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      heard = true;
    };

    await serve(contract, handlers, { onServiceFault })(get('/orders/down'));

    expect(heard).toBe(true);
  });
});

describe('serve: onOutcome', () => {
  test('receives the method, the Endpoint, its declared path, the status, kind and duration of every request, and only the method when none matched', async () => {
    const answered: AnsweredRequest[] = [];
    const http = serve(contract, handlers, {
      onServiceFault: () => undefined,
      onOutcome: (request) => {
        answered.push(request);
      },
    });

    for (const path of ['/orders/o-1', '/orders/missing', '/orders/down', '/customers']) {
      await http(get(path));
    }

    const getOrderRecord = { method: 'GET', endpoint: 'getOrder', path: '/orders/:orderId' };
    expect(answered).toStrictEqual([
      { ...getOrderRecord, status: 200, kind: 'success', durationMs: expect.any(Number) },
      { ...getOrderRecord, status: 404, kind: 'rejection', durationMs: expect.any(Number) },
      { ...getOrderRecord, status: 503, kind: 'fault', durationMs: expect.any(Number) },
      { method: 'GET', status: 404, kind: 'fault', durationMs: expect.any(Number) },
    ]);
    expect(answered.every(({ durationMs }) => durationMs >= 0)).toBe(true);
  });

  test('a request no Endpoint matched carries its method as received, whatever it is', async () => {
    const answered: AnsweredRequest[] = [];
    const http = serve(contract, handlers, {
      onOutcome: (request) => {
        answered.push(request);
      },
    });

    await http(new Request('http://test/customers', { method: 'propfind' }));
    await http(new Request('http://test/customers', { method: 'HEAD' }));

    expect(answered).toStrictEqual([
      { method: 'propfind', status: 404, kind: 'fault', durationMs: expect.any(Number) },
      { method: 'HEAD', status: 404, kind: 'fault', durationMs: expect.any(Number) },
    ]);
  });

  test('a Guard’s Rejection and invalid input carry the Endpoint and its path', async () => {
    const answered: AnsweredRequest[] = [];
    const http = serve(
      contract,
      { ...handlers, guards: { apiKey: handle(apiKey, () => reject(unauthenticated)) } },
      {
        onOutcome: (request) => {
          answered.push(request);
        },
      },
    );
    const json = { 'content-type': 'application/json' };

    await http(get('/orders/o-1'));
    await http(
      new Request('http://test/imports', {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ orders: 1 }),
      }),
    );
    await http(new Request('http://test/imports', { method: 'POST', body: 'not json' }));

    const importRecord = {
      method: 'POST',
      endpoint: 'importOrders',
      path: '/imports',
      kind: 'rejection',
      status: 400,
      durationMs: expect.any(Number),
    };
    expect(answered).toStrictEqual([
      {
        method: 'GET',
        endpoint: 'getOrder',
        path: '/orders/:orderId',
        kind: 'rejection',
        status: 401,
        durationMs: expect.any(Number),
      },
      importRecord,
      importRecord,
    ]);
  });
});

describe('serve: onOutcome for the Caller’s Faults', () => {
  test('METHOD_NOT_ALLOWED is recorded with its method, as a fault with status 405', async () => {
    const answered: AnsweredRequest[] = [];
    const http = serve(contract, handlers, {
      onOutcome: (request) => {
        answered.push(request);
      },
    });

    await http(new Request('http://test/orders', { method: 'DELETE' }));

    expect(answered).toStrictEqual([
      { method: 'DELETE', status: 405, kind: 'fault', durationMs: expect.any(Number) },
    ]);
  });

  test('a request the fallback answered is not recorded', async () => {
    const answered: AnsweredRequest[] = [];
    const http = serve(contract, handlers, {
      fallback: async () => new Response('ok'),
      onOutcome: (request) => {
        answered.push(request);
      },
    });

    await http(get('/healthz'));
    await http(new Request('http://test/orders', { method: 'OPTIONS' }));

    expect(answered).toEqual([]);
  });

  test('RETIRED and BODY_TOO_LARGE are recorded with their method, Endpoint and path', async () => {
    const answered: AnsweredRequest[] = [];
    const http = serve(contract, handlers, {
      maxBodyBytes: 8,
      onOutcome: (request) => {
        answered.push(request);
      },
    });

    await http(new Request('http://test/archive', { method: 'POST' }));
    await http(tooLarge());

    expect(answered).toStrictEqual([
      {
        method: 'POST',
        endpoint: 'archive',
        path: '/archive',
        status: 410,
        kind: 'fault',
        durationMs: expect.any(Number),
      },
      {
        method: 'POST',
        endpoint: 'importOrders',
        path: '/imports',
        status: 413,
        kind: 'fault',
        durationMs: expect.any(Number),
      },
    ]);
  });

  test('durationMs is the time the request took', async () => {
    const answered: AnsweredRequest[] = [];
    const http = serve(contract, handlers, {
      onOutcome: (request) => {
        answered.push(request);
      },
    });

    await http(get('/orders/slow'));

    expect(answered[0]?.durationMs).toBeGreaterThanOrEqual(35);
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
