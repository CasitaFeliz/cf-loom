import {
  defineContract,
  defineEndpoint,
  defineGroup,
  type Endpoint,
} from '@casitafeliz/loom-contract';
import { handle, success } from '@casitafeliz/loom-handlers';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { serve } from './index.ts';

const getOrder = defineEndpoint({
  name: 'getOrder',
  method: 'GET',
  path: '/orders/:orderId',
  visibility: 'public',
  description: 'One order by id',
  input: { params: z.object({ orderId: z.string() }) },
  success: { status: 200, body: z.object({ id: z.string() }) },
});

const getSummary = defineEndpoint({
  name: 'getSummary',
  method: 'GET',
  path: '/orders/summary',
  visibility: 'public',
  description: 'How many orders there are',
  success: { status: 200, body: z.object({ count: z.int() }) },
});

const getInvoice = defineEndpoint({
  name: 'getInvoice',
  method: 'GET',
  path: '/invoices/:invoiceId',
  visibility: 'public',
  description: 'One invoice by id',
  input: { params: z.object({ invoiceId: z.uuid() }) },
  success: { status: 204 },
});

const getLatestItem = defineEndpoint({
  name: 'getLatestItem',
  method: 'GET',
  path: '/items/latest',
  visibility: 'public',
  description: 'The latest item',
  lifecycle: 'retired',
  success: { status: 204 },
});

const getItem = defineEndpoint({
  name: 'getItem',
  method: 'GET',
  path: '/items/:itemId',
  visibility: 'public',
  description: 'One item',
  input: { params: z.object({ itemId: z.string() }) },
  success: { status: 204 },
});

const getRoot = defineEndpoint({
  name: 'getRoot',
  method: 'GET',
  path: '/',
  visibility: 'public',
  description: 'The root',
  success: { status: 200, body: z.object({ root: z.boolean() }) },
});

const handlers = {
  endpoints: {
    getOrder: handle(getOrder, ({ params }) => success({ id: params.orderId, extra: true })),
    getSummary: handle(getSummary, () => success({ count: 3 })),
    getInvoice: handle(getInvoice, () => success()),
    getItem: handle(getItem, () => success()),
    getRoot: handle(getRoot, () => success({ root: true })),
  },
  guards: {},
  deprecatedAt: {},
};

function contractOf(endpoints: readonly [Endpoint, ...Endpoint[]]) {
  return defineContract({
    name: 'orders-service',
    groups: [defineGroup({ name: 'orders', description: 'Orders', endpoints })],
  });
}

const http = serve(
  contractOf([getOrder, getSummary, getInvoice, getLatestItem, getItem, getRoot]),
  handlers,
);

const noSuchEndpoint = {
  fault: {
    code: 'NO_SUCH_ENDPOINT',
    committed: 'no',
    retryable: false,
    message: 'No Endpoint has this method and path',
  },
};

async function answerOf(path: string, init?: RequestInit) {
  const response = await http(new Request(`http://test${path}`, init));
  const text = await response.text();
  return { status: response.status, body: text === '' ? undefined : JSON.parse(text) };
}

describe('serve: matching a request to an Endpoint', () => {
  test('a declared method and path answers the Success, its body parsed with unknown keys stripped', async () => {
    const response = await http(new Request('http://test/orders/o-1'));

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(await response.json()).toEqual({ id: 'o-1' });
  });

  test('an undeclared path is NO_SUCH_ENDPOINT', async () => {
    const answer = await answerOf('/customers');

    expect(answer).toEqual({ status: 404, body: noSuchEndpoint });
  });

  test('a declared path with another method, HEAD on a GET Endpoint included, is NO_SUCH_ENDPOINT', async () => {
    const answers = [
      await answerOf('/orders/o-1', { method: 'HEAD' }),
      await answerOf('/orders/o-1', { method: 'DELETE' }),
    ];

    expect(answers.map(({ status }) => status)).toEqual([404, 404]);
    expect(answers[1]?.body).toEqual(noSuchEndpoint);
  });

  test('OPTIONS and a CORS preflight are NO_SUCH_ENDPOINT unless declared', async () => {
    const preflight = {
      method: 'OPTIONS',
      headers: { origin: 'http://app', 'access-control-request-method': 'GET' },
    };

    const answers = [
      await answerOf('/orders/o-1', { method: 'OPTIONS' }),
      await answerOf('/orders/o-1', preflight),
    ];

    expect(answers).toEqual([
      { status: 404, body: noSuchEndpoint },
      { status: 404, body: noSuchEndpoint },
    ]);
  });

  test('an Endpoint at the root path answers there, and only there', async () => {
    const answers = [await answerOf('/'), await answerOf('/?x=1')];

    expect(answers).toEqual([
      { status: 200, body: { root: true } },
      { status: 200, body: { root: true } },
    ]);
  });

  test('a Retired Endpoint still declared is RETIRED, and shadows the param Endpoint that would match', async () => {
    const answer = await answerOf('/items/latest');

    expect(answer).toEqual({
      status: 410,
      body: {
        fault: {
          code: 'RETIRED',
          committed: 'no',
          retryable: false,
          message: 'The Endpoint is retired',
        },
      },
    });
  });

  test('a literal beats a param at the first segment where they differ, whichever is declared first', async () => {
    const literalLast = serve(contractOf([getOrder, getSummary]), handlers);
    const literalFirst = serve(contractOf([getSummary, getOrder]), handlers);

    const answers = [
      await (await literalLast(new Request('http://test/orders/summary'))).json(),
      await (await literalFirst(new Request('http://test/orders/summary'))).json(),
    ];

    expect(answers).toEqual([{ count: 3 }, { count: 3 }]);
  });

  test('a request path matches exactly: no trailing slash, case or double slash folding', async () => {
    const paths = [
      '/orders/summary/',
      '/Orders/summary',
      '/orders//summary',
      '//orders/o-1',
      '//orders',
      '/orders/',
    ];

    const statuses = await Promise.all(paths.map(async (path) => (await answerOf(path)).status));

    expect(statuses).toEqual([404, 404, 404, 404, 404, 404]);
  });

  test('the path is the URL’s path: dot segments, %2e included, are removed and \\ reads as / before matching', async () => {
    const answers = [
      await answerOf('/orders/o-1/../summary'),
      await answerOf('/orders/o-1/%2e%2e/summary'),
      await answerOf('/orders/./summary'),
      await answerOf('/orders\\summary'),
    ];

    expect(answers).toEqual(Array(4).fill({ status: 200, body: { count: 3 } }));
  });

  test('the query string takes no part in matching', async () => {
    const answer = await answerOf('/orders/summary?orderId=o-1');

    expect(answer).toEqual({ status: 200, body: { count: 3 } });
  });

  test('each segment is percent-decoded on its own, so a value never spans segments', async () => {
    const answer = await answerOf('/orders/a%2Fb');

    expect(answer).toEqual({ status: 200, body: { id: 'a/b' } });
  });

  test('a segment that is not valid percent-encoding is kept as sent', async () => {
    const answer = await answerOf('/orders/100%25%zz');

    expect(answer).toEqual({ status: 200, body: { id: '100%25%zz' } });
  });

  test('a path param that fails its schema is invalid input, never not found', async () => {
    const answer = await answerOf('/invoices/nope');

    expect(answer).toEqual({
      status: 400,
      body: {
        rejection: {
          code: 'INVALID_INPUT',
          message: 'Invalid input',
          body: {
            issues: [
              {
                in: 'params',
                path: ['invoiceId'],
                code: 'invalid_format',
                message: expect.any(String),
              },
            ],
          },
        },
      },
    });
  });
});
