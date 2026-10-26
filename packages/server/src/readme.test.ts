import { once } from 'node:events';
import {
  defineContract,
  defineEndpoint,
  defineGroup,
  defineGuard,
  type Method,
  notFound,
} from '@cf-loom/contract';
import { admit, handle, reject, success, type WithResources } from '@cf-loom/handlers';
import { describe, expect, expectTypeOf, test } from 'vitest';
import { z } from 'zod';
import { type Http, serve } from './index.ts';
import { nodeHttp } from './node-http/index.ts';

const ORDER_ID = '7f1c3a52-1b2c-4d3e-8f4a-5b6c7d8e9f00';

const apiKey = defineGuard({
  name: 'apiKey',
  description: 'An API key per Caller',
  demands: { headers: z.object({ 'x-api-key': z.string().optional() }) },
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

const noteOrder = defineEndpoint({
  name: 'noteOrder',
  method: 'POST',
  path: '/notes',
  visibility: 'public',
  description: 'A note on an order, which takes no Resources',
  input: { body: z.object({ text: z.string() }) },
  success: { status: 200, body: z.object({ text: z.string() }) },
});

const contract = defineContract({
  name: 'orders-service',
  groups: [
    defineGroup({ name: 'orders', description: 'Orders', endpoints: [getOrder, noteOrder] }),
  ],
});

type Resources = { readonly orders: { readonly nameOf: (orderId: string) => string } };

/** The Handler map as `cf-loom generate` writes it, with a GuardHandler that refuses every key. */
const handlers = {
  endpoints: {
    getOrder: handle(
      getOrder,
      ({ params }, { context }, { resources: { orders } }: WithResources<Resources>) =>
        success({ id: orders.nameOf(params.orderId), callerId: context.apiKey.callerId }),
    ),
    noteOrder: handle(noteOrder, ({ body }) => success({ text: body.text })),
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
      onServiceFault: (fault, request) => {
        expectTypeOf(fault.identity).toEqualTypeOf<string>();
        expectTypeOf(request).toEqualTypeOf<Request>();
      },
      onAnswered: async (answered, request) => {
        const { method, endpoint, path, status, kind, code, aborted, durationMs } = answered;
        expectTypeOf([
          method,
          endpoint,
          path,
          status,
          kind,
          code,
          aborted,
          durationMs,
        ]).not.toBeNever();
        expectTypeOf(request.headers.get('traceparent')).toEqualTypeOf<string | null>();
      },
    });

    expectTypeOf(http).toEqualTypeOf<Http>();
    expectTypeOf(http).toEqualTypeOf<(request: Request) => Promise<Response>>();
    expect(typeof http).toBe('function');
  });

  test('the HTTP-only main.ts serves the Contract with a body limit, and its server closes', async () => {
    const http = serve(contract, handlers, { resources, maxBodyBytes: 1_048_576 });
    const server = nodeHttp(http).listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (typeof address !== 'object' || address === null) {
      throw new Error('The server listens on a port');
    }

    const tooLarge = await fetch(`http://127.0.0.1:${address.port}/notes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'x'.repeat(1_048_577) }),
    });
    server.close();
    await once(server, 'close');

    expect(tooLarge.status).toBe(413);
    expect(await tooLarge.json()).toMatchObject({ fault: { code: 'BODY_TOO_LARGE' } });
    expect(server.listening).toBe(false);
  });

  test('serve takes no resources when no Handler takes any', () => {
    const notes = defineContract({
      name: 'notes-service',
      groups: [defineGroup({ name: 'notes', description: 'Notes', endpoints: [noteOrder] })],
    });
    const noteHandlers = {
      endpoints: { noteOrder: handle(noteOrder, ({ body }) => success({ text: body.text })) },
      guards: {},
      commands: {},
      subscriptions: {},
      deprecatedAt: {},
    };

    const http = serve(notes, noteHandlers, { maxBodyBytes: 1_048_576 });

    expect(typeof http).toBe('function');
  });

  test('a record with an Endpoint has its path and declared method, one without has neither', () => {
    const http = serve(contract, handlers, {
      resources,
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

    expect(typeof http).toBe('function');
  });
});
