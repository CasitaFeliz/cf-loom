import { type ChildProcess, spawn } from 'node:child_process';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { client } from '@casitafeliz/loom-client';
import { serve } from '@casitafeliz/loom-server';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { ordersDeps } from '../src/contract/dependencies/orders-service.dependencies.ts';
import { contract } from '../src/contract/index.ts';
import handlers from '../src/handlers.generated.ts';

const ordersDir = join(import.meta.dirname, '../../orders-service');
const PAID_ORDER_ID = '7d4f0a52-3c1b-4e8a-9f6d-1a2b3c4d5e6f';
const PENDING_ORDER_ID = 'c2a9e1f4-8b7d-4f3a-a6e5-0d1c2b3a4f5e';
const LOCKED_ORDER_ID = '5e8b2c7a-1d4f-4a9e-b3c6-7f8e9d0a1b2c';
const UNKNOWN_ORDER_ID = '00000000-0000-4000-8000-000000000000';
const billing = serve(contract, handlers);
let orders: ChildProcess | undefined;
let ordersUrl = '';

/** orders-service's `main.ts` in a process of its own, on a free port, and the port it printed. */
async function startOrders(): Promise<{ process: ChildProcess; port: string }> {
  const started = spawn(process.execPath, ['src/main.ts'], {
    cwd: ordersDir,
    // biome-ignore lint/style/useNamingConvention: the environment variable orders-service reads
    env: { ...process.env, PORT: '0' },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  for await (const line of createInterface({ input: started.stdout })) {
    const port = /listening on (\d+)$/.exec(line)?.[1];
    if (port !== undefined) return { process: started, port };
  }
  throw new Error('orders-service exited before it listened');
}

beforeAll(async () => {
  const started = await startOrders();
  orders = started.process;
  ordersUrl = `http://127.0.0.1:${started.port}`;
  vi.stubEnv('ORDERS_SERVICE_URL', ordersUrl);
  vi.stubEnv('ORDERS_SERVICE_API_KEY', 'billing-key');
});

afterAll(() => {
  vi.unstubAllEnvs();
  orders?.kill();
});

function anInvoiceRequest(orderId: string): Request {
  return new Request('http://billing.test/invoices', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ orderId }),
  });
}

describe('billing-service calling orders-service over HTTP', () => {
  test('a paid order is billed for its total', async () => {
    const response = await billing(anInvoiceRequest(PAID_ORDER_ID));

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      orderId: PAID_ORDER_ID,
      total: { amount: 4200, currency: 'EUR' },
    });
  });

  test('an order orders-service does not know is answered NOT_FOUND', async () => {
    const response = await billing(anInvoiceRequest(UNKNOWN_ORDER_ID));

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ rejection: { code: 'NOT_FOUND' } });
  });

  test('a pending order is answered ORDER_NOT_BILLABLE with its status', async () => {
    const response = await billing(anInvoiceRequest(PENDING_ORDER_ID));

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      rejection: { code: 'ORDER_NOT_BILLABLE', body: { orderStatus: 'pending' } },
    });
  });

  test('the client receives ORDER_LOCKED with the instant the order was locked', async () => {
    const ordersClient = client(ordersDeps, {
      baseUrl: ordersUrl,
      headers: { 'x-api-key': 'billing-key' },
    });

    const outcome = await ordersClient.getOrder({ params: { orderId: LOCKED_ORDER_ID } });

    expect(outcome).toMatchObject({
      kind: 'rejection',
      known: true,
      code: 'ORDER_LOCKED',
      body: { lockedAt: '2026-01-15T09:30:00Z' },
    });
  });

  test('a client with an unknown key receives UNAUTHENTICATED', async () => {
    const ordersClient = client(ordersDeps, {
      baseUrl: ordersUrl,
      headers: { 'x-api-key': 'stolen-key' },
    });

    const outcome = await ordersClient.getOrder({ params: { orderId: PAID_ORDER_ID } });

    expect(outcome).toMatchObject({ kind: 'rejection', known: true, code: 'UNAUTHENTICATED' });
  });
});
