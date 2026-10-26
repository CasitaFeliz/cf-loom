import {
  defineDefinitions,
  defineEndpoint,
  defineGroup,
  defineGuard,
  defineRejection,
  defineService,
} from '@cf-loom/contract';
import { admit, fault, type HandledRequest, handle, reject, success } from '@cf-loom/handlers';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { type ServedFault, serve } from './index.ts';

const ORDER_ID = '7f1c3a52-1b2c-4d3e-8f4a-5b6c7d8e9f00';

const unauthenticated = defineRejection({
  code: 'UNAUTHENTICATED',
  status: 401,
  message: 'Unauthenticated',
});

const forbidden = defineRejection({ code: 'FORBIDDEN', status: 403, message: 'Forbidden' });

const userToken = defineGuard({
  name: 'userToken',
  description: 'A user',
  demands: { headers: z.object({ authorization: z.string() }) },
  context: z.object({ userId: z.string() }),
  rejections: [unauthenticated],
});

const permission = defineGuard({
  name: 'permission',
  description: 'The user holds every listed permission',
  guards: [userToken],
  qualifier: z.array(z.enum(['orders:read', 'orders:edit'])).min(1),
  context: z.object({ granted: z.array(z.string()) }),
  rejections: [forbidden],
});

const tenant = defineGuard({
  name: 'tenant',
  description: 'The tenant a request acts for',
  demands: { headers: z.object({ 'x-tenant': z.string() }) },
});

const updateOrder = defineEndpoint({
  name: 'updateOrder',
  method: 'PUT',
  path: '/orders/:orderId',
  visibility: 'public',
  description: 'Changes an order',
  guards: [userToken, { guard: permission, qualifier: ['orders:edit'] }],
  input: { params: z.object({ orderId: z.uuid() }) },
  success: { status: 200, body: z.object({ by: z.string(), granted: z.array(z.string()) }) },
});

const misattached = defineEndpoint({
  name: 'misattached',
  method: 'GET',
  path: '/misattached',
  visibility: 'public',
  description: 'Attaches a Qualifier its Guard refuses',
  guards: [userToken, { guard: permission, qualifier: ['orders:delete'] as never }],
  success: { status: 204 },
});

const addNote = defineEndpoint({
  name: 'addNote',
  method: 'POST',
  path: '/notes',
  visibility: 'public',
  description: 'Adds a note',
  guards: [userToken],
  input: { body: z.object({ text: z.string() }) },
  success: { status: 204 },
});

const listOrders = defineEndpoint({
  name: 'listOrders',
  method: 'GET',
  path: '/orders',
  visibility: 'public',
  description: 'A tenant’s orders',
  guards: [userToken, tenant],
  success: { status: 204 },
});

const contract = defineService({
  name: 'orders-service',
  groups: [
    defineGroup({
      name: 'orders',
      description: 'Orders',
      endpoints: [updateOrder, misattached, addNote, listOrders],
    }),
  ],
});

const calls: string[] = [];

const userTokenHandler = handle(userToken, ({ headers }) => {
  calls.push('userToken');
  if (headers.authorization !== 'Bearer u-1') {
    return reject(unauthenticated);
  }
  return admit({ userId: 'u-1' });
});

const permissionHandler = handle(
  permission,
  (_demands, { context: { userToken: user }, qualifier }) => {
    calls.push('permission');
    return admit({ granted: [user.userId, ...qualifier] });
  },
);

const updateOrderHandler = handle(updateOrder, (_input, { context }) => {
  calls.push('updateOrder');
  return success({ by: context.userToken.userId, granted: context.permission.granted });
});

const handlers = {
  endpoints: {
    updateOrder: updateOrderHandler,
    misattached: handle.stub(misattached),
    addNote: handle(addNote, () => success()),
    listOrders: handle(listOrders, () => success()),
  },
  guards: {
    userToken: userTokenHandler,
    permission: permissionHandler,
    tenant: handle(tenant, () => admit()),
  },
};

function put(
  orderId: string,
  headers: Record<string, string> = { authorization: 'Bearer u-1' },
): Request {
  return new Request(`http://test/orders/${orderId}`, { method: 'PUT', headers });
}

describe('serve: Guards', () => {
  test('a Guard’s Context reaches the EndpointHandler and the Guards that list it, with the Qualifier', async () => {
    calls.length = 0;

    const response = await serve(contract, handlers)(put(ORDER_ID));

    expect(await response.json()).toEqual({ by: 'u-1', granted: ['u-1', 'orders:edit'] });
    expect(calls).toEqual(['userToken', 'permission', 'updateOrder']);
  });

  test('Guards run before the Endpoint’s Input: a missing demanded header is answered, a bad param is not', async () => {
    const response = await serve(contract, handlers)(put('nope', {}));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      rejection: {
        code: 'INVALID_INPUT',
        message: 'Invalid input',
        body: {
          issues: [
            {
              in: 'headers',
              path: ['authorization'],
              code: 'required',
              message: expect.any(String),
            },
          ],
        },
      },
    });
  });

  test('Guards run before the body is read: a malformed or oversized body gets the Guard’s answer', async () => {
    const http = serve(contract, handlers, { maxBodyBytes: 8 });
    const headers = { 'content-type': 'application/json' };

    const answers = await Promise.all(
      ['nope', JSON.stringify({ text: 'x'.repeat(100) })].map(async (body) => {
        const response = await http(
          new Request('http://test/notes', { method: 'POST', headers, body }),
        );
        return { status: response.status, body: await response.json() };
      }),
    );

    const guardIssue = {
      rejection: { body: { issues: [{ in: 'headers', path: ['authorization'] }] } },
    };
    expect(answers).toMatchObject([
      { status: 400, body: guardIssue },
      { status: 400, body: guardIssue },
    ]);
  });

  test('a GuardHandler’s retryable Fault with retryAfter is sent with retry-after', async () => {
    const busy = handle(userToken, () =>
      fault({ committed: 'no', retryable: true, retryAfter: 30 }),
    );
    const http = serve(contract, { ...handlers, guards: { ...handlers.guards, userToken: busy } });

    const response = await http(put(ORDER_ID));

    expect(response.status).toBe(503);
    expect(response.headers.get('retry-after')).toBe('30');
  });

  test('a GuardHandler’s Rejection stops the request with its declared status', async () => {
    calls.length = 0;

    const response = await serve(contract, handlers)(put(ORDER_ID, { authorization: 'Bearer x' }));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      rejection: { code: 'UNAUTHENTICATED', message: 'Unauthenticated' },
    });
    expect(calls).toEqual(['userToken']);
  });

  test('a GuardHandler’s Rejection is answered though a later Guard’s demands fail', async () => {
    const request = new Request('http://test/orders', { headers: { authorization: 'Bearer x' } });

    const response = await serve(contract, handlers)(request);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      rejection: { code: 'UNAUTHENTICATED', message: 'Unauthenticated' },
    });
  });

  test('a body is never pulled when a GuardHandler rejects the request', async () => {
    let pulls = 0;
    const body = new ReadableStream(
      {
        pull(controller) {
          pulls += 1;
          controller.enqueue(new TextEncoder().encode('{"text":"a"}'));
          controller.close();
        },
      },
      { highWaterMark: 0 },
    );
    const headers = { authorization: 'Bearer x', 'content-type': 'application/json' };
    const init = { method: 'POST', headers, body, duplex: 'half' } as RequestInit;

    await serve(contract, handlers)(new Request('http://test/notes', init));

    expect(pulls).toBe(0);
  });

  test('a GuardHandler stub answers not implemented once its demands are valid', async () => {
    const stubbed = {
      ...handlers,
      guards: { ...handlers.guards, userToken: handle.stub(userToken) },
    };
    const http = serve(contract, stubbed);

    const valid = await http(put(ORDER_ID));
    const invalid = await http(put(ORDER_ID, {}));

    expect(valid.status).toBe(501);
    expect(await valid.json()).toEqual({
      rejection: { code: 'NOT_IMPLEMENTED', message: 'Not implemented' },
    });
    expect(invalid.status).toBe(400);
  });

  test('a GuardHandler under serve receives the request’s headers and its signal', async () => {
    const controller = new AbortController();
    const received: HandledRequest[] = [];
    const reading = handle(userToken, (_demands, { request }) => {
      received.push(request);
      return admit({ userId: 'u-1' });
    });
    const served = { ...handlers, guards: { ...handlers.guards, userToken: reading } };
    const headers = { authorization: 'Bearer u-1', 'x-request-id': 'r-7' };

    await serve(
      contract,
      served,
    )(
      new Request('http://test/notes', {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'hi' }),
        signal: controller.signal,
      }),
    );
    controller.abort();

    expect(received[0]?.headers.get('x-request-id')).toBe('r-7');
    expect(received[0]?.signal.aborted).toBe(true);
  });

  test('a GuardHandler stub answers the not-implemented code its Root resolves', async () => {
    const definitions = defineDefinitions({
      standardRejections: {
        notImplemented: { code: 'NOT_YET_IMPLEMENTED', status: 501, message: 'Coming soon' },
      },
    });
    const rooted = defineService({
      name: 'orders-service',
      standardRejections: definitions,
      groups: [defineGroup({ name: 'orders', description: 'Orders', endpoints: [addNote] })],
    });
    const stubbed = {
      endpoints: { addNote: handlers.endpoints.addNote },
      guards: { userToken: handle.stub(userToken) },
    };
    const headers = { authorization: 'Bearer u-1', 'content-type': 'application/json' };
    const body = JSON.stringify({ text: 'hi' });

    const response = await serve(
      rooted,
      stubbed,
    )(new Request('http://test/notes', { method: 'POST', headers, body }));

    expect(response.status).toBe(501);
    expect(await response.json()).toEqual({
      rejection: { code: 'NOT_YET_IMPLEMENTED', message: 'Coming soon' },
    });
  });

  test('an EndpointHandler stub answers not implemented', async () => {
    const stubbed = {
      ...handlers,
      endpoints: { ...handlers.endpoints, updateOrder: handle.stub(updateOrder) },
    };

    const response = await serve(contract, stubbed)(put(ORDER_ID));

    expect(response.status).toBe(501);
    expect(await response.json()).toEqual({
      rejection: { code: 'NOT_IMPLEMENTED', message: 'Not implemented' },
    });
  });

  test('an admit() that breaks the Guard’s context is INVALID_OUTCOME, the Guard named to onServiceFault', async () => {
    const faults: ServedFault[] = [];
    const broken = handle(userToken, () => admit({ userId: 7 } as never));
    const http = serve(
      contract,
      { ...handlers, guards: { ...handlers.guards, userToken: broken } },
      {
        onServiceFault: (fault) => {
          faults.push(fault);
        },
      },
    );

    const response = await http(put(ORDER_ID));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
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
        element: updateOrder,
        identity: 'updateOrder',
        guard: userToken,
        issues: [
          { part: 'context', path: ['userId'], code: 'invalid_type', message: expect.any(String) },
        ],
      },
    ]);
  });

  test('a Qualifier serve hands a Guard that breaks its schema is the runtime’s own bug', async () => {
    const faults: ServedFault[] = [];
    const http = serve(contract, handlers, {
      onServiceFault: (fault) => {
        faults.push(fault);
      },
    });

    const response = await http(
      new Request('http://test/misattached', { headers: { authorization: 'Bearer u-1' } }),
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      fault: { committed: 'no', retryable: false, message: 'Internal error' },
    });
    expect(faults).toMatchObject([
      {
        kind: 'runtime-bug',
        element: misattached,
        identity: 'misattached',
        guard: permission,
        issues: [{ part: 'qualifier', path: [0], code: 'invalid_value' }],
      },
    ]);
  });
});
