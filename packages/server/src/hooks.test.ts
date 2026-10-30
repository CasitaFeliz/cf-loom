import {
  defineDefinitions,
  defineEndpoint,
  defineGroup,
  defineGuard,
  defineRejection,
  defineService,
  type Method,
  notFound,
} from '@cf-loom/contract';
import {
  admit,
  fault,
  type HandlerMapOf,
  handle,
  type NoResources,
  reject,
  success,
} from '@cf-loom/handlers';
import { afterEach, describe, expect, expectTypeOf, test, vi } from 'vitest';
import { z } from 'zod';
import {
  type AnsweredRequest,
  type Http,
  type ServedFault,
  type ServeOptions,
  serve,
} from './index.ts';

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
  deprecatedAt: '2026-10-17T09:30:00Z',
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

const contract = defineService({
  name: 'orders-service',
  groups: [
    defineGroup({
      name: 'orders',
      description: 'Orders',
      endpoints: [getOrder, listOrders, archive, importOrders],
    }),
  ],
});

/** The Handlers, `getOrder` answering by its param: a Success, a Rejection, a Fault or a broken body. */
const handlers = {
  endpoints: {
    getOrder: handle(getOrder, async ({ params }) => {
      switch (params.orderId) {
        case 'slow':
          await new Promise((resolve) => setTimeout(resolve, 40));
          return success(getOrder, { secret: 'a long enough secret' });
        case 'missing':
          return reject(notFound);
        case 'down':
          return fault({ committed: 'no', retryable: true });
        case 'leaky':
          return success(getOrder, { secret: 'short' });
        case 'thrown':
          throw new Error('a bug');
        default:
          return success(getOrder, { secret: 'a long enough secret' });
      }
    }),
    listOrders: handle(listOrders, () => success(listOrders, { count: 1 })),
    importOrders: handle(importOrders, () => success(importOrders)),
  },
  guards: { apiKey: handle(apiKey, () => admit(apiKey, { callerId: 'c-1' })) },
};

const downFault = { committed: 'no', retryable: true } as const;

/** Each character a reader may end a line at, with its name and the text that shows its escape. */
const lineBreaks = [
  ['LF', 0x0a, '\\n'],
  ['CR', 0x0d, '\\r'],
  ['U+0085', 0x85, '\\u0085'],
  ['U+2028', 0x2028, '\\u2028'],
  ['U+2029', 0x2029, '\\u2029'],
  ['U+000B', 0x0b, '\\u000b'],
  ['U+000C', 0x0c, '\\u000c'],
  ['U+001C', 0x1c, '\\u001c'],
  ['U+001D', 0x1d, '\\u001d'],
  ['U+001E', 0x1e, '\\u001e'],
] as const;

/** Splits a text where any reader would end a line. */
const lineBreakPattern = new RegExp(
  `[${lineBreaks.map(([, code]) => String.fromCharCode(code)).join('')}]`,
);

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function tooLarge(): Request {
  const body = JSON.stringify({ orders: ['o-1', 'o-2', 'o-3'] });
  const headers = { 'content-type': 'application/json' };
  return new Request('http://test/imports', { method: 'POST', headers, body });
}

function get(path: string): Request {
  return new Request(`http://test${path}`);
}

/** The fields every record of a request answered before the Caller went away carries. */
function sent(status: number, kind: AnsweredRequest['kind']) {
  return { status, kind, aborted: false, durationMs: expect.any(Number) };
}

/** Serves the map with an `onAnswered` that keeps every record, and the records it kept. */
function recording(
  options: Omit<ServeOptions, 'onAnswered'> = {},
  served: Pick<HandlerMapOf<typeof contract, NoResources>, 'endpoints' | 'guards'> = handlers,
) {
  const answered: AnsweredRequest[] = [];
  const requests: Request[] = [];
  const http = serve(contract, served, {
    ...options,
    onAnswered: (record, request) => {
      answered.push(record);
      requests.push(request);
    },
  });
  return { http, answered, requests };
}

describe('serve: onServiceFault', () => {
  test('without it, the console receives each issue’s part, path and code, never the received value', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await serve(contract, handlers, {})(get('/orders/leaky'));

    expect(logged).toHaveBeenCalledTimes(1);
    const line = String(logged.mock.calls[0]?.[0]);
    expect(line).toMatch(/^getOrder: success\.body\.secret too_small: /);
    expect(line).not.toContain('short');
  });

  test('without it, a throw is logged as the Handler threw, with its cause', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await serve(contract, handlers, {})(get('/orders/thrown'));

    expect(logged).toHaveBeenCalledWith('getOrder: the Handler threw', new Error('a bug'));
  });

  test('without it, the console names the Guard whose Handler failed', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const broken = handle(apiKey, () => admit(apiKey, { callerId: 7 } as never));

    await serve(contract, { ...handlers, guards: { apiKey: broken } }, {})(get('/orders/o-1'));

    expect(String(logged.mock.calls[0]?.[0])).toMatch(
      /^getOrder apiKey: context\.callerId invalid_type: /,
    );
  });

  test.for(lineBreaks)(
    'without it, a Caller’s record key holding %s, echoed into a body that breaks the Success, is logged on one line per Issue',
    async ([, code, visible]) => {
      const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const key = `a${String.fromCharCode(code)}b`;
      const tally = defineEndpoint({
        name: 'tally',
        method: 'POST',
        path: '/tally',
        visibility: 'public',
        description: 'Echoes the counts as words',
        input: { body: z.record(z.string(), z.number()) },
        success: { status: 200, body: z.record(z.string(), z.string()) },
      });
      const tallyContract = defineService({
        name: 'orders-service',
        groups: [defineGroup({ name: 'tallies', description: 'Tallies', endpoints: [tally] })],
      });
      const tallyHandlers = {
        endpoints: { tally: handle(tally, ({ body }) => success(tally, body as never)) },
        guards: {},
      };
      const expectedMessage = 'Invalid input: expected string, received number';
      const headers = { 'content-type': 'application/json' };
      const body = JSON.stringify({ [key]: 1, other: 2 });

      const response = await serve(
        tallyContract,
        tallyHandlers,
        {},
      )(new Request('http://test/tally', { method: 'POST', headers, body }));

      expect(response.status).toBe(500);
      const lines = logged.mock.calls.map(([line]) => String(line));
      expect(lines.map((line) => line.split(lineBreakPattern))).toEqual([
        [`tally: success.body.a${visible}b invalid_type: ${expectedMessage}`],
        [`tally: success.body.other invalid_type: ${expectedMessage}`],
      ]);
    },
  );

  test('without it, the console receives a returned Fault with its message', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await serve(contract, handlers, {})(get('/orders/down'));

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
      { declaration: getOrder, name: 'getOrder', kind: 'thrown', cause: new Error('a bug') },
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
        declaration: getOrder,
        name: 'getOrder',
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

  test('onAnswered still receives the record when onServiceFault throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const answered: AnsweredRequest[] = [];
    const http = serve(contract, handlers, {
      onServiceFault: throwing,
      onAnswered: (record) => {
        answered.push(record);
      },
    });

    await http(get('/orders/down'));

    expect(answered.map(({ status }) => status)).toEqual([503]);
  });

  test.each([
    ['throws', throwing],
    ['rejects', rejecting],
  ])('an onAnswered that %s leaves the response returned, and is logged', async (_, onAnswered) => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const response = await serve(contract, handlers, { onAnswered })(get('/orders/o-1'));

    expect(response.status).toBe(200);
    expect(logged).toHaveBeenCalledWith('getOrder: onAnswered threw', broken);
  });

  test('an onAnswered that throws for a request no Endpoint matched is logged as serve’s', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await serve(contract, handlers, { onAnswered: throwing })(get('/customers'));

    expect(logged).toHaveBeenCalledWith('serve: onAnswered threw', broken);
  });

  test('serve waits for an async onAnswered before it resolves', async () => {
    let recorded = false;
    const onAnswered = async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      recorded = true;
    };

    await serve(contract, handlers, { onAnswered })(get('/orders/o-1'));

    expect(recorded).toBe(true);
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

describe('serve: onAnswered', () => {
  test('receives the method, the Endpoint, its declared path, the status, kind and duration of every request, and only the method when none matched', async () => {
    const answered: AnsweredRequest[] = [];
    const http = serve(contract, handlers, {
      onServiceFault: () => undefined,
      onAnswered: (record) => {
        answered.push(record);
      },
    });

    for (const path of ['/orders/o-1', '/orders/missing', '/orders/down', '/customers']) {
      await http(get(path));
    }

    const getOrderRecord = { method: 'GET', endpoint: 'getOrder', path: '/orders/:orderId' };
    expect(answered).toStrictEqual([
      { ...getOrderRecord, ...sent(200, 'success') },
      { ...getOrderRecord, ...sent(404, 'rejection'), code: 'NOT_FOUND' },
      { ...getOrderRecord, ...sent(503, 'fault') },
      { method: 'GET', ...sent(404, 'fault'), code: 'NO_SUCH_ENDPOINT' },
    ]);
    expect(answered.every(({ durationMs }) => durationMs >= 0)).toBe(true);
  });

  test('a Guard’s Rejection and invalid input carry the Endpoint and its path', async () => {
    const answered: AnsweredRequest[] = [];
    const http = serve(
      contract,
      { ...handlers, guards: { apiKey: handle(apiKey, () => reject(unauthenticated)) } },
      {
        onAnswered: (record) => {
          answered.push(record);
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
      ...sent(400, 'rejection'),
      code: 'INVALID_INPUT',
    };
    expect(answered).toStrictEqual([
      {
        method: 'GET',
        endpoint: 'getOrder',
        path: '/orders/:orderId',
        ...sent(401, 'rejection'),
        code: 'UNAUTHENTICATED',
      },
      importRecord,
      importRecord,
    ]);
  });
});

describe('serve: onAnswered for the Caller’s Faults', () => {
  test('METHOD_NOT_ALLOWED is recorded with its method, as a fault with status 405', async () => {
    const answered: AnsweredRequest[] = [];
    const http = serve(contract, handlers, {
      onAnswered: (record) => {
        answered.push(record);
      },
    });

    await http(new Request('http://test/orders', { method: 'DELETE' }));

    expect(answered).toStrictEqual([
      { method: 'DELETE', ...sent(405, 'fault'), code: 'METHOD_NOT_ALLOWED' },
    ]);
  });

  test('a request the fallback answered is not recorded', async () => {
    const answered: AnsweredRequest[] = [];
    const http = serve(contract, handlers, {
      fallback: async () => new Response('ok'),
      onAnswered: (record) => {
        answered.push(record);
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
      onAnswered: (record) => {
        answered.push(record);
      },
    });

    await http(new Request('http://test/archive', { method: 'POST' }));
    await http(tooLarge());

    expect(answered).toStrictEqual([
      {
        method: 'POST',
        endpoint: 'archive',
        path: '/archive',
        ...sent(410, 'fault'),
        code: 'RETIRED',
      },
      {
        method: 'POST',
        endpoint: 'importOrders',
        path: '/imports',
        ...sent(413, 'fault'),
        code: 'BODY_TOO_LARGE',
      },
    ]);
  });

  test('durationMs is the time the request took', async () => {
    const answered: AnsweredRequest[] = [];
    const http = serve(contract, handlers, {
      onAnswered: (record) => {
        answered.push(record);
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

  test('a Deprecated Endpoint whose deprecatedAt lies in the future carries it too', async () => {
    const scheduled = defineEndpoint({
      name: 'scheduled',
      method: 'GET',
      path: '/scheduled',
      visibility: 'public',
      description: 'Deprecated as of a day to come',
      lifecycle: 'deprecated',
      deprecatedAt: '2999-01-01T00:00:00Z',
      success: { status: 204 },
    });
    const service = defineService({
      name: 'orders-service',
      groups: [defineGroup({ name: 'orders', description: 'Orders', endpoints: [scheduled] })],
    });
    const http = serve(
      service,
      {
        endpoints: { scheduled: handle(scheduled, () => success(scheduled)) },
        guards: {},
      },
      {},
    );

    const response = await http(get('/scheduled'));

    expect(response.headers.get('deprecation')).toBe('@32472144000');
  });

  test('an Active Endpoint’s response carries none', async () => {
    const response = await serve(contract, handlers, {})(get('/orders'));

    expect(response.headers.get('deprecation')).toBeNull();
  });
});

describe('serve: what the hooks receive beside the record', () => {
  test('onServiceFault receives the Request beside the Fault', async () => {
    const requests: Request[] = [];
    const request = get('/orders/thrown');

    await serve(contract, handlers, {
      onServiceFault: (_fault, received) => {
        requests.push(received);
      },
    })(request);

    expect(requests).toEqual([request]);
  });

  test('onAnswered receives the Request beside the record, its traceparent readable', async () => {
    const { http, requests } = recording();
    const traceparent = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';

    await http(new Request('http://test/orders/o-1', { headers: { traceparent } }));

    expect(requests[0]?.headers.get('traceparent')).toBe(traceparent);
  });

  test('a request no Endpoint matched, with a method no Endpoint may declare, is recorded as _OTHER', async () => {
    const { http, answered } = recording();

    await http(new Request('http://test/customers', { method: 'X-ABC123' }));
    await http(new Request('http://test/customers', { method: 'propfind' }));

    expect(answered.map(({ method }) => method)).toEqual(['_OTHER', '_OTHER']);
  });

  test('a request no Endpoint matched keeps a method an Endpoint may declare, and HEAD', async () => {
    const { http, answered } = recording();

    await http(new Request('http://test/customers', { method: 'OPTIONS' }));
    await http(new Request('http://test/customers', { method: 'HEAD' }));

    expect(answered.map(({ method }) => method)).toEqual(['OPTIONS', 'HEAD']);
  });

  test('a Rejection is recorded with the code its Root resolves', async () => {
    const definitions = defineDefinitions({
      standardRejections: { notFound: { code: 'MISSING', status: 404, message: 'Nothing here' } },
    });
    const rooted = defineService({
      name: 'orders-service',
      standardRejections: definitions,
      groups: contract.groups,
    });
    const answered: AnsweredRequest[] = [];
    const http = serve(rooted, handlers, {
      onAnswered: (record) => {
        answered.push(record);
      },
    });

    await http(get('/orders/missing'));

    expect(answered[0]?.code).toBe('MISSING');
  });

  test('the invalid-input Rejection is recorded with the code its Root resolves', async () => {
    const definitions = defineDefinitions({
      standardRejections: {
        invalidInput: { code: 'BAD_REQUEST', status: 422, message: 'The request is invalid' },
      },
    });
    const rooted = defineService({
      name: 'orders-service',
      standardRejections: definitions,
      groups: contract.groups,
    });
    const answered: AnsweredRequest[] = [];
    const http = serve(rooted, handlers, {
      onAnswered: (record) => {
        answered.push(record);
      },
    });

    await http(new Request('http://test/imports', { method: 'POST', body: 'not json' }));

    expect(answered[0]).toMatchObject({ status: 422, code: 'BAD_REQUEST' });
  });

  test.each([
    ['RETIRED', new Request('http://test/archive', { method: 'POST' })],
    ['NO_SUCH_ENDPOINT', get('/customers')],
    ['METHOD_NOT_ALLOWED', new Request('http://test/orders', { method: 'DELETE' })],
    ['BODY_TOO_LARGE', tooLarge()],
    ['INVALID_OUTCOME', get('/orders/leaky')],
  ])('a Fault with the Reserved code %s is recorded with it', async (code, request) => {
    const { http, answered } = recording({ maxBodyBytes: 8, onServiceFault: () => undefined });

    await http(request);

    expect(answered[0]).toMatchObject({ kind: 'fault', code });
  });

  test('a Fault a Handler returned is recorded with no code', async () => {
    const { http, answered } = recording({ onServiceFault: () => undefined });

    await http(get('/orders/down'));

    expect(answered[0]).toStrictEqual({
      kind: 'fault',
      status: 503,
      aborted: false,
      durationMs: expect.any(Number),
      method: 'GET',
      endpoint: 'getOrder',
      path: '/orders/:orderId',
    });
  });

  test('a request whose signal was aborted before the answer is recorded as aborted', async () => {
    const controller = new AbortController();
    const slow = handle(getOrder, async () => {
      controller.abort();
      return success(getOrder, { secret: 'a long enough secret' });
    });
    const { http, answered } = recording(
      {},
      {
        ...handlers,
        endpoints: { ...handlers.endpoints, getOrder: slow },
      },
    );

    await http(new Request('http://test/orders/o-1', { signal: controller.signal }));

    expect(answered[0]?.aborted).toBe(true);
  });

  test('a Caller that aborts while onServiceFault runs is recorded as aborted, and durationMs includes the time onServiceFault took', async () => {
    vi.useFakeTimers({ toFake: ['performance'] });
    const controller = new AbortController();
    const { http, answered } = recording({
      onServiceFault: () => {
        vi.advanceTimersByTime(250);
        controller.abort();
      },
    });

    await http(new Request('http://test/orders/down', { signal: controller.signal }));

    expect(answered[0]).toMatchObject({ kind: 'fault', aborted: true, durationMs: 250 });
  });
});

describe('serve: the types of its hooks and of what it returns', () => {
  test('serve returns the web-standard Http, and onAnswered reads the Request’s headers', () => {
    const http = serve(contract, handlers, {
      onAnswered: (_answered, request) => {
        expectTypeOf(request.headers.get('traceparent')).toEqualTypeOf<string | null>();
      },
    });

    expectTypeOf(http).toEqualTypeOf<Http>();
    expectTypeOf(http).toEqualTypeOf<(request: Request) => Promise<Response>>();
    expect(http).toBeTypeOf('function');
  });

  test('a record with an Endpoint has its path and declared method, one without has neither', () => {
    const http = serve(contract, handlers, {
      onAnswered: (record) => {
        if (record.endpoint !== undefined) {
          expectTypeOf(record.path).toEqualTypeOf<string>();
          expectTypeOf(record.method).toEqualTypeOf<Method>();
          return;
        }
        expectTypeOf(record.path).toEqualTypeOf<undefined>();
        expectTypeOf(record.method).toEqualTypeOf<Method | 'HEAD' | '_OTHER'>();
      },
    });

    expect(http).toBeTypeOf('function');
  });
});
