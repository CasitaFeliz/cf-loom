import { createServer, request as nodeRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  defineContract,
  defineEndpoint,
  defineGroup,
  defineGuard,
} from '@casitafeliz/loom-contract';
import { admit, handle, success } from '@casitafeliz/loom-handlers';
import { afterEach, describe, expect, test } from 'vitest';
import { z } from 'zod';
import { serve } from '../index.ts';
import { nodeHttp, nodeListener } from './index.ts';

const apiKey = defineGuard({
  name: 'apiKey',
  description: 'A key per client',
  demands: { headers: z.object({ 'x-api-key': z.string() }) },
  context: z.object({ clientId: z.string() }),
});

const createOrder = defineEndpoint({
  name: 'createOrder',
  method: 'POST',
  path: '/orders',
  visibility: 'public',
  description: 'A new order',
  guards: [apiKey],
  input: { body: z.object({ quantity: z.int() }) },
  success: {
    status: 201,
    headers: z.object({ 'x-order-count': z.int() }),
    body: z.object({ quantity: z.int(), by: z.string() }),
  },
});

const contract = defineContract({
  name: 'orders-service',
  groups: [defineGroup({ name: 'orders', description: 'Orders', endpoints: [createOrder] })],
});

const handlers = {
  endpoints: {
    createOrder: handle(createOrder, ({ body }, { apiKey: client }) =>
      success({ headers: { 'x-order-count': 1 }, body: { ...body, by: client.clientId } }),
    ),
  },
  guards: { apiKey: handle(apiKey, ({ headers }) => admit({ clientId: headers['x-api-key'] })) },
  deprecatedAt: {},
};

const servers: ReturnType<typeof nodeHttp>[] = [];

afterEach(() => {
  for (const server of servers.splice(0)) {
    server.close();
  }
});

/** The Service listening on a free port, and the URL it answers at. */
async function listening(server = nodeHttp(serve(contract, handlers))): Promise<string> {
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

describe('nodeHttp', () => {
  test('a POST with a JSON body and a demanded header answers the Success through node:http', async () => {
    const url = await listening();

    const response = await fetch(`${url}/orders`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': 'c-1' },
      body: JSON.stringify({ quantity: 2 }),
    });

    expect(response.status).toBe(201);
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(response.headers.get('x-order-count')).toBe('1');
    expect(await response.json()).toEqual({ quantity: 2, by: 'c-1' });
  });

  test('a GET to an undeclared path answers NO_SUCH_ENDPOINT', async () => {
    const url = await listening();

    const response = await fetch(`${url}/customers`);

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ fault: { code: 'NO_SUCH_ENDPOINT' } });
  });

  test.each([
    ['missing', {}],
    ['naming no URL', { host: 'not a host' }],
  ])('a request whose Host header is %s is answered 400', async (_case, headers) => {
    const url = new URL(await listening());

    const status = await new Promise<number | undefined>((resolve, reject) => {
      const options = { host: url.hostname, port: url.port, path: '/orders', setHost: false };
      const sent = nodeRequest({ ...options, headers }, (response) => {
        response.resume();
        resolve(response.statusCode);
      });
      sent.on('error', reject);
      sent.end();
    });

    expect(status).toBe(400);
  });

  test('nodeListener serves a node:http server the Service creates itself', async () => {
    const url = await listening(createServer(nodeListener(serve(contract, handlers))));

    const response = await fetch(`${url}/customers`);

    expect(response.status).toBe(404);
  });

  test('close() ends the server', async () => {
    const url = await listening();
    const server = servers.pop();

    await new Promise((resolve) => server?.close(resolve));

    await expect(fetch(`${url}/customers`)).rejects.toThrow();
  });
});
