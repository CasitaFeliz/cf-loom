import { once } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { serve } from '@cf-loom/server';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { contract } from '../src/contract/index.ts';
import handlers from '../src/handlers.generated.ts';

const billing = serve(contract, handlers, { onServiceFault: () => undefined });
const orders = createServer((_, response) => {
  response.writeHead(429).end();
});

beforeAll(async () => {
  orders.listen(0, '127.0.0.1');
  await once(orders, 'listening');
  const { port } = orders.address() as AddressInfo;
  vi.stubEnv('ORDERS_SERVICE_URL', `http://127.0.0.1:${port}`);
  vi.stubEnv('ORDERS_SERVICE_API_KEY', 'billing-key');
});

afterAll(async () => {
  vi.unstubAllEnvs();
  orders.close();
  await once(orders, 'close');
});

describe('billing-service when orders-service answers 429', () => {
  test('createInvoice answers 503, a retryable Fault that changed nothing', async () => {
    const request = new Request('http://billing.test/invoices', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orderId: '7d4f0a52-3c1b-4e8a-9f6d-1a2b3c4d5e6f' }),
    });

    const response = await billing(request);

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ fault: { committed: 'no', retryable: true } });
  });
});
