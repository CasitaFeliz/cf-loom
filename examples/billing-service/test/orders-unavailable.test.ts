import { once } from 'node:events';
import { type AddressInfo, createServer } from 'node:net';
import { serve } from '@casitafeliz/loom-server';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { contract } from '../src/contract/index.ts';
import handlers from '../src/handlers.generated.ts';

const billing = serve(contract, handlers, { onServiceFault: () => undefined });

/** A port nothing listens on: one the system just handed out and took back. */
async function aClosedPort(): Promise<number> {
  const server = createServer().listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;
  server.close();
  await once(server, 'close');
  return port;
}

beforeAll(async () => {
  vi.stubEnv('ORDERS_SERVICE_URL', `http://127.0.0.1:${await aClosedPort()}`);
  vi.stubEnv('ORDERS_SERVICE_API_KEY', 'billing-key');
});

afterAll(() => {
  vi.unstubAllEnvs();
});

describe('billing-service when orders-service cannot be reached', () => {
  test('createInvoice answers a retryable Fault that changed nothing', async () => {
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
