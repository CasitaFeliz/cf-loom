import { type ChildProcess, spawn } from 'node:child_process';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import type { Readable } from 'node:stream';
import { client } from '@cf-loom/client';
import { serve } from '@cf-loom/server';
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

/** The port orders-service's `main.ts` prints once it listens. */
async function portOf(stdout: Readable): Promise<string> {
  for await (const line of createInterface({ input: stdout })) {
    const port = /listening on (\d+)$/.exec(line)?.[1];
    if (port !== undefined) return port;
  }
  throw new Error('orders-service exited before it listened');
}

beforeAll(async () => {
  const started = spawn(process.execPath, ['src/main.ts'], {
    cwd: ordersDir,
    // biome-ignore lint/style/useNamingConvention: the environment variable orders-service reads
    env: { ...process.env, PORT: '0' },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  orders = started;
  ordersUrl = `http://127.0.0.1:${await portOf(started.stdout)}`;
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

  test('an order orders-service does not know is answered RESOURCE_NOT_FOUND', async () => {
    const response = await billing(anInvoiceRequest(UNKNOWN_ORDER_ID));

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ rejection: { code: 'RESOURCE_NOT_FOUND' } });
  });

  test('a pending order is answered ORDER_NOT_BILLABLE with its status', async () => {
    const response = await billing(anInvoiceRequest(PENDING_ORDER_ID));

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      rejection: { code: 'ORDER_NOT_BILLABLE', body: { orderStatus: 'pending' } },
    });
  });

  test('a locked order is answered ORDER_LOCKED with the instant it was locked', async () => {
    const response = await billing(anInvoiceRequest(LOCKED_ORDER_ID));

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      rejection: { code: 'ORDER_LOCKED', body: { lockedAt: '2026-01-15T09:30:00Z' } },
    });
  });
});

describe('a client of orders-service over HTTP', () => {
  test('it receives ORDER_LOCKED with the instant the order was locked', async () => {
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

  test('it receives RESOURCE_NOT_FOUND for an order nobody placed, known, with orders-service’s message', async () => {
    const ordersClient = client(ordersDeps, {
      baseUrl: ordersUrl,
      headers: { 'x-api-key': 'billing-key' },
    });

    const outcome = await ordersClient.getOrder({ params: { orderId: UNKNOWN_ORDER_ID } });

    expect(outcome).toMatchObject({
      kind: 'rejection',
      known: true,
      code: 'RESOURCE_NOT_FOUND',
      message: 'The resource does not exist',
    });
  });

  test('with an unknown key it receives UNAUTHENTICATED', async () => {
    const ordersClient = client(ordersDeps, {
      baseUrl: ordersUrl,
      headers: { 'x-api-key': 'stolen-key' },
    });

    const outcome = await ordersClient.getOrder({ params: { orderId: PAID_ORDER_ID } });

    expect(outcome).toMatchObject({ kind: 'rejection', known: true, code: 'UNAUTHENTICATED' });
  });
});
