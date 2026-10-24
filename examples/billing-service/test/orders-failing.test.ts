import { once } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { type Http, serve } from '@cf-loom/server';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { contract } from '../src/contract/index.ts';
import handlers from '../src/generated/handlers.generated.ts';
import { ordersClientOf } from '../src/orders-client/orders-client.ts';

let billing: Http;
const orders = createServer((_, response) => {
  response.writeHead(502).end();
});

beforeAll(async () => {
  orders.listen(0, '127.0.0.1');
  await once(orders, 'listening');
  const { port } = orders.address() as AddressInfo;
  const resources = { orders: ordersClientOf(`http://127.0.0.1:${port}`, 'billing-key') };
  billing = serve(contract, handlers, { resources, onServiceFault: () => undefined });
});

afterAll(async () => {
  orders.close();
  await once(orders, 'close');
});

describe('billing-service when orders-service answers 502', () => {
  test('createInvoice answers 500, a Fault that changed nothing and is not retryable', async () => {
    const request = new Request('http://billing.test/invoices', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orderId: '7d4f0a52-3c1b-4e8a-9f6d-1a2b3c4d5e6f' }),
    });

    const response = await billing(request);

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ fault: { committed: 'no', retryable: false } });
  });
});
