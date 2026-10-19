import {
  defineContract,
  defineDefinitions,
  defineEndpoint,
  defineGroup,
  defineRejection,
  notFound,
} from '@casitafeliz/loom-contract';
import {
  type EndpointImplementation,
  fault,
  handle,
  reject,
  success,
} from '@casitafeliz/loom-handlers';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { type ServiceFault, serve } from './index.ts';

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
    headers: z.object({ 'x-total': z.int(), etag: z.string() }),
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

const headOrder = defineEndpoint({
  name: 'headOrder',
  method: 'HEAD',
  path: '/orders/:orderId',
  visibility: 'public',
  description: 'Whether an order exists',
  input: { params: z.object({ orderId: z.string() }) },
  success: { status: 200, headers: z.object({ 'x-total': z.int() }) },
});

const definitions = defineDefinitions({
  name: 'definitions',
  standardRejections: {
    invalidInput: { code: 'BAD_REQUEST', status: 422, message: 'The request is invalid' },
    notFound: { code: 'MISSING', status: 404, message: 'Nothing here' },
  },
});

const contract = defineContract({
  name: 'orders-service',
  definitions: [definitions],
  groups: [
    defineGroup({
      name: 'orders',
      description: 'Orders',
      endpoints: [getOrder, updateOrder, headOrder],
    }),
  ],
});

const order = { id: 'o-1', total: 3 };
const lockedAt = '2026-10-18T10:00:00Z';

function serveWith(implementation: EndpointImplementation<typeof getOrder>) {
  const faults: ServiceFault[] = [];
  const http = serve(
    contract,
    {
      endpoints: {
        getOrder: handle(getOrder, implementation),
        updateOrder: handle(updateOrder, () => success()),
        headOrder: handle(headOrder, () => success({ headers: { 'x-total': 3 } })),
      },
      guards: {},
      deprecatedAt: {},
    },
    { onServiceFault: (serviceFault) => faults.push(serviceFault) },
  );
  return { http, faults };
}

const getRequest = new Request('http://test/orders/o-1');

describe('serve: a Success', () => {
  test('sends its declared headers as text with the parsed body', async () => {
    const { http } = serveWith(() =>
      success({ headers: { 'x-total': 3, etag: 'v1' }, body: { ...order, extra: true } }),
    );

    const response = await http(getRequest.clone());

    expect(response.status).toBe(200);
    expect([response.headers.get('x-total'), response.headers.get('etag')]).toEqual(['3', 'v1']);
    expect(await response.json()).toEqual(order);
  });

  test('a 204 sends no body and no content type', async () => {
    const { http } = serveWith(() => reject(notFound));

    const response = await http(new Request('http://test/orders/o-1', { method: 'PUT' }));

    expect(response.status).toBe(204);
    expect(response.headers.get('content-type')).toBeNull();
    expect(await response.text()).toBe('');
  });

  test('a HEAD Endpoint’s Success sends its status and headers only', async () => {
    const { http } = serveWith(() => reject(notFound));

    const response = await http(new Request('http://test/orders/o-1', { method: 'HEAD' }));

    expect(response.status).toBe(200);
    expect(response.headers.get('x-total')).toBe('3');
    expect(response.headers.get('content-type')).toBeNull();
    expect(await response.text()).toBe('');
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

  test('a Standard Rejection resolves to the listed Definitions Package’s code, status and message, with no body key', async () => {
    const { http } = serveWith(() => reject(notFound));

    const response = await http(getRequest.clone());

    expect(response.status).toBe(404);
    expect(await response.json()).toStrictEqual({
      rejection: { code: 'MISSING', message: 'Nothing here' },
    });
  });

  test('the invalid-input Rejection is the root’s, its issues with no received value', async () => {
    const { http } = serveWith(() =>
      success({ headers: { 'x-total': 3, etag: 'v1' }, body: order }),
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
        },
      },
    });
  });
});

describe('serve: a Fault', () => {
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
        endpoint: 'getOrder',
        fault: { kind: 'fault', committed: 'no', retryable: true, message: 'Try again', cause },
      },
    ]);
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
      { kind: 'thrown', endpoint: 'getOrder', fault: { cause: broken } },
    ]);
  });

  test('a Handler that returns no Outcome answers the same Fault, a TypeError as cause', async () => {
    const { http, faults } = serveWith(() => undefined as never);

    const response = await http(getRequest.clone());

    expect(response.status).toBe(500);
    expect(faults).toMatchObject([{ kind: 'thrown', fault: { cause: expect.any(TypeError) } }]);
  });

  test('an Outcome that breaks a constraint is INVALID_OUTCOME, its issues to the Service only', async () => {
    const { http, faults } = serveWith(() =>
      success({ headers: { 'x-total': 3, etag: 'v1' }, body: { id: 'o-1', total: -1 } }),
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
        endpoint: 'getOrder',
        issues: [
          { part: 'success.body', path: ['total'], code: 'too_small', message: expect.any(String) },
        ],
      },
    ]);
  });
});
