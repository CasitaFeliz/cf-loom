import { once } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { serve } from '@casitafeliz/loom-server';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { contract } from '../src/contract/index.ts';
import handlers from '../src/handlers.generated.ts';

const billing = serve(contract, handlers, { onServiceFault: () => undefined });
const orders = createServer((_, response) => {
  response.writeHead(502).end();
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
