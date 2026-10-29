import {
  defineDefinitions,
  defineEndpoint,
  defineGroup,
  defineRejection,
  defineService,
  notFound,
} from '@cf-loom/contract';
import {
  type EndpointImplementation,
  fault,
  handle,
  InvalidOutcomeError,
  type Issue,
  reject,
  success,
} from '@cf-loom/handlers';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { type ServedFault, serve } from './index.ts';

const orderLocked = defineRejection({
  code: 'ORDER_LOCKED',
  status: 409,
  message: 'The order can no longer be changed',
  body: z.object({ lockedAt: z.iso.datetime() }),
});

const getOrder = defineEndpoint({
  name: 'getOrder',
  method: 'GET',
  path: '/orders/:orderId',
  visibility: 'public',
  description: 'One order',
  input: { params: z.object({ orderId: z.string().min(3) }) },
  success: {
    status: 200,
    headers: z.object({ 'x-total': z.int(), etag: z.string().optional() }),
    body: z.object({ id: z.string(), total: z.int().min(0) }),
  },
  rejections: [notFound, orderLocked],
});

const updateOrder = defineEndpoint({
  name: 'updateOrder',
  method: 'PUT',
  path: '/orders/:orderId',
  visibility: 'public',
  description: 'Changes an order',
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

const definitions = defineDefinitions({
  standardRejections: {
    invalidInput: { code: 'BAD_REQUEST', status: 422, message: 'The request is invalid' },
    notFound: { code: 'MISSING', status: 404, message: 'Nothing here' },
  },
});

const contract = defineService({
  name: 'orders-service',
  standardRejections: definitions,
  groups: [
    defineGroup({
      name: 'orders',
      description: 'Orders',
      endpoints: [getOrder, updateOrder, orderTotal],
    }),
  ],
});

const order = { id: 'o-1', total: 3 };
const lockedAt = '2026-10-18T10:00:00Z';

function serveWith(implementation: EndpointImplementation<typeof getOrder>) {
  const faults: ServedFault[] = [];
  const http = serve(
    contract,
    {
      endpoints: {
        getOrder: handle(getOrder, implementation),
        updateOrder: handle(updateOrder, () => success(updateOrder)),
        orderTotal: handle(orderTotal, () => success(orderTotal, { headers: { 'x-total': 3 } })),
      },
      guards: {},
    },
    {
      onServiceFault: (serviceFault) => {
        faults.push(serviceFault);
      },
    },
  );
  return { http, faults };
}

const getRequest = new Request('http://test/orders/o-1');

describe('serve: a Success', () => {
  test('sends its declared headers as text with the parsed body', async () => {
    const orderWithExtra = { ...order, extra: true };
    const { http } = serveWith(() =>
      success(getOrder, { headers: { 'x-total': 3, etag: 'v1' }, body: orderWithExtra }),
    );

    const response = await http(getRequest.clone());

    expect(response.status).toBe(200);
    expect([response.headers.get('x-total'), response.headers.get('etag')]).toEqual(['3', 'v1']);
    expect(await response.json()).toEqual(order);
  });

  test('a header value with a tab inside, or U+00FF, travels', async () => {
    const { http } = serveWith(() =>
      success(getOrder, { headers: { 'x-total': 3, etag: 'v\t\u00ff' }, body: order }),
    );

    const response = await http(getRequest.clone());

    expect(response.status).toBe(200);
    expect(response.headers.get('etag')).toBe('v\t\u00ff');
  });

  test('an optional header the Handler gives as undefined is not sent', async () => {
    const { http } = serveWith(() =>
      success(getOrder, { headers: { 'x-total': 3, etag: undefined }, body: order }),
    );

    const response = await http(getRequest.clone());

    expect(response.status).toBe(200);
    expect(response.headers.has('etag')).toBe(false);
  });

  test('an optional header the Handler leaves out is not sent', async () => {
    const { http } = serveWith(() => success(getOrder, { headers: { 'x-total': 3 }, body: order }));

    const response = await http(getRequest.clone());

    expect(response.status).toBe(200);
    expect(response.headers.has('etag')).toBe(false);
  });

  test.each([
    ['above U+00FF', 'v€'],
    ['with a line feed', 'v\n1'],
    ['with a carriage return', 'v\r1'],
    ['with a NUL', 'v\u00001'],
    ['with U+0100', 'v\u0100'],
    ['with a control character', 'v\u0001'],
    ['with DEL', 'v\u007f'],
    ['with a leading space', ' v1'],
  ])('a header value %s cannot travel, so it is INVALID_OUTCOME', async (_case, etag) => {
    const { http, faults } = serveWith(() =>
      success(getOrder, { headers: { 'x-total': 3, etag }, body: order }),
    );

    const response = await http(getRequest.clone());

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ fault: { code: 'INVALID_OUTCOME' } });
    expect(faults).toEqual([
      {
        kind: 'invalid-outcome',
        declaration: getOrder,
        name: 'getOrder',
        issues: [
          {
            part: 'success.headers',
            path: ['etag'],
            code: 'invalid_format',
            message: expect.any(String),
          },
        ],
      },
    ]);
  });

  test('a 204 sends no body and no content type', async () => {
    const { http } = serveWith(() => reject(notFound));

    const response = await http(new Request('http://test/orders/o-1', { method: 'PUT' }));

    expect(response.status).toBe(204);
    expect(response.headers.get('content-type')).toBeNull();
    expect(await response.text()).toBe('');
  });

  test('a headers-only Success sends its status and headers only', async () => {
    const { http } = serveWith(() => reject(notFound));

    const response = await http(new Request('http://test/orders/o-1/total'));

    expect(response.status).toBe(204);
    expect(response.headers.get('x-total')).toBe('3');
    expect(response.headers.get('content-type')).toBeNull();
    expect(await response.text()).toBe('');
  });
});

describe('a direct call and serve agree', () => {
  const getInput = { params: { orderId: 'o-1' } };

  async function issuesThrownBy(call: () => Promise<unknown>): Promise<readonly Issue[]> {
    try {
      await call();
    } catch (e) {
      if (e instanceof InvalidOutcomeError) {
        return e.issues;
      }
      throw e;
    }
    throw new Error('the direct call did not throw');
  }

  test.each([
    ['above U+00FF', 'v€'],
    ['with a line feed', 'v\n1'],
    ['with a leading space', ' v1'],
    ['with a trailing tab', 'v1\t'],
  ])(
    'a Success header value %s: serve answers INVALID_OUTCOME with the Issues the direct call throws',
    async (_case, etag) => {
      const implementation = () =>
        success(getOrder, { headers: { 'x-total': 3, etag }, body: order });
      const { http, faults } = serveWith(implementation);

      const thrown = await issuesThrownBy(() => handle(getOrder, implementation)(getInput, {}));
      const response = await http(getRequest.clone());

      expect(response.status).toBe(500);
      expect(faults).toEqual([
        { kind: 'invalid-outcome', declaration: getOrder, name: 'getOrder', issues: thrown },
      ]);
    },
  );

  test('a Fault built with a reserved code: the direct call returns it as built, serve sends it without its code', async () => {
    const forged = {
      kind: 'fault',
      code: 'NO_SUCH_ENDPOINT',
      committed: 'yes',
      retryable: true,
      message: 'forged',
    };
    const { http } = serveWith(() => forged as never);

    const returned = await handle(getOrder, () => forged as never)(getInput, {});
    const response = await http(getRequest.clone());

    expect(returned).toStrictEqual(forged);
    expect(await response.json()).toStrictEqual({
      fault: { committed: 'yes', retryable: true, message: 'forged' },
    });
  });
});

describe('serve: a Success body that is JSON null', () => {
  test('is sent as null, with the JSON content type', async () => {
    const findNote = defineEndpoint({
      name: 'findNote',
      method: 'GET',
      path: '/note',
      visibility: 'public',
      description: 'The note, if any',
      success: { status: 200, body: z.object({ text: z.string() }).nullable() },
    });
    const withNote = defineService({
      name: 'notes-service',
      groups: [defineGroup({ name: 'notes', description: 'Notes', endpoints: [findNote] })],
    });
    const http = serve(
      withNote,
      {
        endpoints: { findNote: handle(findNote, () => success(findNote, null)) },
        guards: {},
      },
      {},
    );

    const response = await http(new Request('http://test/note'));

    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(await response.text()).toBe('null');
  });
});

describe('serve: a Rejection', () => {
  test('travels with its declared status, code, message and body', async () => {
    const { http } = serveWith(() => reject(orderLocked, { lockedAt }));

    const response = await http(getRequest.clone());

    expect(response.status).toBe(409);
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(await response.json()).toEqual({
      rejection: {
        code: 'ORDER_LOCKED',
        message: 'The order can no longer be changed',
        body: { lockedAt },
      },
    });
  });

  test('a Standard Rejection resolves to the code, status and message of the Definitions Package named as standardRejections, with no body key', async () => {
    const { http } = serveWith(() => reject(notFound));

    const response = await http(getRequest.clone());

    expect(response.status).toBe(404);
    expect(await response.json()).toStrictEqual({
      rejection: { code: 'MISSING', message: 'Nothing here' },
    });
  });

  test('the invalid-input Rejection is the Root’s, its issues with no received value', async () => {
    const { http } = serveWith(() =>
      success(getOrder, { headers: { 'x-total': 3, etag: 'v1' }, body: order }),
    );

    const response = await http(new Request('http://test/orders/zz'));

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      rejection: {
        code: 'BAD_REQUEST',
        message: 'The request is invalid',
        body: {
          issues: [
            { in: 'params', path: ['orderId'], code: 'too_small', message: expect.any(String) },
          ],
          omittedIssues: 0,
        },
      },
    });
  });
});

describe('serve: a Fault', () => {
  test('a retryable Fault with retryAfter is sent with retry-after, and one without it with none', async () => {
    const later = serveWith(() => fault({ committed: 'no', retryable: true, retryAfter: 5 }));
    const now = serveWith(() => fault({ committed: 'no', retryable: true }));

    const responses = [await later.http(getRequest.clone()), await now.http(getRequest.clone())];

    expect(responses.map(({ status }) => status)).toEqual([503, 503]);
    expect(responses.map(({ headers }) => headers.get('retry-after'))).toEqual(['5', null]);
  });

  test.each([
    ['a negative one', { retryable: true, retryAfter: -1 }],
    ['one that is no number', { retryable: true, retryAfter: 'a\nb' as never }],
    ['one on a Fault that is not retryable', { retryable: false, retryAfter: 5 }],
  ])(
    'a Fault built by hand with %s as retryAfter is INVALID_OUTCOME, with no retry-after',
    async (_, built) => {
      const { http, faults } = serveWith(
        () => ({ kind: 'fault', committed: 'no', message: 'Down', ...built }) as never,
      );

      const response = await http(getRequest.clone());

      expect(response.status).toBe(500);
      expect(response.headers.get('retry-after')).toBeNull();
      expect(await response.json()).toMatchObject({ fault: { code: 'INVALID_OUTCOME' } });
      expect(faults).toMatchObject([
        { kind: 'invalid-outcome', issues: [{ part: 'fault', path: ['retryAfter'] }] },
      ]);
    },
  );

  test('a Fault the Handler returns travels with 503 when retryable, its cause kept from the Caller', async () => {
    const cause = new Error('the database is down');
    const { http, faults } = serveWith(() =>
      fault({ committed: 'no', retryable: true, message: 'Try again', cause }),
    );

    const response = await http(getRequest.clone());

    expect(response.status).toBe(503);
    expect(await response.json()).toStrictEqual({
      fault: { committed: 'no', retryable: true, message: 'Try again' },
    });
    expect(faults).toEqual([
      {
        kind: 'returned',
        declaration: getOrder,
        name: 'getOrder',
        fault: { kind: 'fault', committed: 'no', retryable: true, message: 'Try again', cause },
      },
    ]);
  });

  test('a Fault the Handler builds with a reserved code still travels as its own, never as that code', async () => {
    const forged = {
      kind: 'fault',
      code: 'NO_SUCH_ENDPOINT',
      committed: 'yes',
      retryable: true,
      message: 'forged',
    };
    const { http } = serveWith(() => forged as never);

    const response = await http(getRequest.clone());

    expect(response.status).toBe(503);
    expect(await response.json()).toStrictEqual({
      fault: { committed: 'yes', retryable: true, message: 'forged' },
    });
  });

  test('a Fault that is not retryable travels with 500', async () => {
    const { http } = serveWith(() => fault({ committed: 'yes', retryable: false }));

    const response = await http(getRequest.clone());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      fault: { committed: 'yes', retryable: false, message: 'Internal error' },
    });
  });

  test('a Handler that throws answers 500 Internal error, and onServiceFault receives the error', async () => {
    const broken = new Error('a bug');
    const { http, faults } = serveWith(() => {
      throw broken;
    });

    const response = await http(getRequest.clone());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      fault: { committed: 'unknown', retryable: false, message: 'Internal error' },
    });
    expect(faults).toMatchObject([
      { kind: 'thrown', declaration: getOrder, name: 'getOrder', cause: broken },
    ]);
  });

  test('a Handler that returns no Outcome answers the same Fault, a TypeError as cause', async () => {
    const { http, faults } = serveWith(() => undefined as never);

    const response = await http(getRequest.clone());

    expect(response.status).toBe(500);
    expect(faults).toMatchObject([{ kind: 'thrown', cause: expect.any(TypeError) }]);
  });

  test('an Outcome that breaks a constraint is INVALID_OUTCOME, its issues to the Service only', async () => {
    const { http, faults } = serveWith(() =>
      success(getOrder, { headers: { 'x-total': 3, etag: 'v1' }, body: { id: 'o-1', total: -1 } }),
    );

    const response = await http(getRequest.clone());

    expect(response.status).toBe(500);
    expect(await response.json()).toStrictEqual({
      fault: {
        code: 'INVALID_OUTCOME',
        committed: 'unknown',
        retryable: false,
        message: 'The Outcome broke the Contract',
      },
    });
    expect(faults).toEqual([
      {
        kind: 'invalid-outcome',
        declaration: getOrder,
        name: 'getOrder',
        issues: [
          { part: 'success.body', path: ['total'], code: 'too_small', message: expect.any(String) },
        ],
      },
    ]);
  });
});

describe('serve: a Success body of many Issues', () => {
  const listTags = defineEndpoint({
    name: 'listTags',
    method: 'GET',
    path: '/tags',
    visibility: 'public',
    description: 'The tags',
    success: { status: 200, body: z.array(z.string()) },
  });
  const tagging = defineService({
    name: 'tags-service',
    groups: [defineGroup({ name: 'tags', description: 'Tags', endpoints: [listTags] })],
  });

  test('a Success whose 300,000 body items each break its schema is an invalid outcome, not the Handler’s throw', async () => {
    const faults: ServedFault[] = [];
    const wide = Array.from({ length: 300_000 }, () => 1) as unknown as string[];
    const http = serve(
      tagging,
      { endpoints: { listTags: handle(listTags, () => success(listTags, wide)) }, guards: {} },
      {
        onServiceFault: (fault) => {
          faults.push(fault);
        },
      },
    );

    const response = await http(new Request('http://test/tags'));

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ fault: { code: 'INVALID_OUTCOME' } });
    expect(faults).toMatchObject([{ kind: 'invalid-outcome', name: 'listTags' }]);
    const reported = faults[0] as { issues: readonly Issue[] };
    expect(reported.issues).toHaveLength(300_000);
    expect(reported.issues[299_999]?.path).toEqual([299_999]);
  });
});
