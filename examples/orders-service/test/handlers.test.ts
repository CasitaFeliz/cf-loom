import { notFound } from '@cf-loom/contract';
import { InvalidInputError, isRejectionOf } from '@cf-loom/handlers';
import { type Messaging, messaging } from '@cf-loom/messaging';
import { memory } from '@cf-loom/messaging/memory';
import { unauthenticated } from '@org/definitions';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { contract } from '../src/contract/index.ts';
import { orderLocked } from '../src/contract/rejections/order-locked.rejection.ts';
import healthHandler from '../src/endpoints/infrastructure/health.handler.ts';
import createOrderHandler from '../src/endpoints/orders/create-order.handler.ts';
import getOrderHandler from '../src/endpoints/orders/get-order.handler.ts';
import apiKeyHandler from '../src/guards/api-key.handler.ts';
import type { Resources } from '../src/resources.ts';

const PAID_ORDER_ID = '7d4f0a52-3c1b-4e8a-9f6d-1a2b3c4d5e6f';
const LOCKED_ORDER_ID = '5e8b2c7a-1d4f-4a9e-b3c6-7f8e9d0a1b2c';
const UNKNOWN_ORDER_ID = '00000000-0000-4000-8000-000000000000';
const CUSTOMER_ID = '9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';
const context = { apiKey: { callerId: 'billing-service' } };
let running: Messaging<typeof contract>;
let resources: Resources;

beforeAll(async () => {
  running = await messaging(contract, memory());
  resources = { publisher: running.publisher, sender: running.sender };
});

afterAll(async () => {
  await running.close();
});

describe('getOrder', () => {
  test('a seeded order is answered with its status and total', async () => {
    const input = { params: { orderId: PAID_ORDER_ID } };

    const outcome = await getOrderHandler(input, { context });

    expect(outcome).toMatchObject({
      kind: 'success',
      status: 200,
      body: {
        id: PAID_ORDER_ID,
        customerId: CUSTOMER_ID,
        status: 'paid',
        total: { amount: 4200, currency: 'EUR' },
      },
    });
  });

  test('an order nobody placed is answered the not-found Rejection', async () => {
    const input = { params: { orderId: UNKNOWN_ORDER_ID } };

    const outcome = await getOrderHandler(input, { context });

    expect(isRejectionOf(outcome, notFound)).toBe(true);
  });

  test('a locked order is answered ORDER_LOCKED with the instant it was locked', async () => {
    const input = { params: { orderId: LOCKED_ORDER_ID } };

    const outcome = await getOrderHandler(input, { context });

    expect(isRejectionOf(outcome, orderLocked) && outcome.body).toEqual({
      lockedAt: '2026-01-15T09:30:00Z',
    });
  });

  test('an order id that is no UUID throws InvalidInputError', async () => {
    const input = { params: { orderId: 'o-1' } };

    const called = getOrderHandler(input, { context });

    await expect(called).rejects.toBeInstanceOf(InvalidInputError);
  });
});

describe('createOrder', () => {
  test('a placed order is answered 201 as pending, with a new id', async () => {
    const total = { amount: 1500, currency: 'EUR' };

    const input = { body: { customerId: CUSTOMER_ID, total } };

    const outcome = await createOrderHandler(input, { context }, { resources });

    expect(outcome).toMatchObject({
      kind: 'success',
      status: 201,
      body: { customerId: CUSTOMER_ID, status: 'pending', total },
    });
    expect(outcome.kind === 'success' && outcome.body.id).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('apiKey', () => {
  test('a known key is admitted with the Caller it belongs to', async () => {
    const demands = { headers: { 'x-api-key': 'billing-key' } };

    const admission = await apiKeyHandler(demands, {});

    expect(admission).toEqual({ kind: 'admitted', context: { callerId: 'billing-service' } });
  });

  test('an unknown key is answered UNAUTHENTICATED', async () => {
    const demands = { headers: { 'x-api-key': 'stolen-key' } };

    const admission = await apiKeyHandler(demands, {});

    expect(isRejectionOf(admission, unauthenticated)).toBe(true);
  });

  test('a missing key is answered UNAUTHENTICATED', async () => {
    const demands = { headers: {} };

    const admission = await apiKeyHandler(demands, {});

    expect(isRejectionOf(admission, unauthenticated)).toBe(true);
  });
});

describe('health', () => {
  test('the Service says it is up', async () => {
    const outcome = await healthHandler({}, {});

    expect(outcome).toMatchObject({ kind: 'success', status: 200, body: { up: true } });
  });
});
