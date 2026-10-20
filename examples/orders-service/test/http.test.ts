import { admit, handle } from '@cf-loom/handlers';
import { serve } from '@cf-loom/server';
import { describe, expect, test } from 'vitest';
import { apiKey } from '../src/contract/guards/api-key.guard.ts';
import { contract } from '../src/contract/index.ts';
import handlers from '../src/handlers.generated.ts';

const PAID_ORDER_ID = '7d4f0a52-3c1b-4e8a-9f6d-1a2b3c4d5e6f';
const CUSTOMER_ID = '9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';
const http = serve(contract, handlers, { onServiceFault: () => undefined });

function aRequest(path: string, init: RequestInit = {}): Request {
  return new Request(`http://orders.test${path}`, init);
}

describe('serve', () => {
  test('a known key reads an order as JSON', async () => {
    const request = aRequest(`/orders/${PAID_ORDER_ID}`, {
      headers: { 'x-api-key': 'billing-key' },
    });

    const response = await http(request);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(await response.json()).toMatchObject({ id: PAID_ORDER_ID, status: 'paid' });
  });

  test('a test replaces the GuardHandler by spreading the Handler map', async () => {
    const anyKey = handle(apiKey, async () => admit({ callerId: 'test' }));
    const admitting = serve(contract, {
      ...handlers,
      guards: { ...handlers.guards, apiKey: anyKey },
    });
    const request = aRequest(`/orders/${PAID_ORDER_ID}`, { headers: { 'x-api-key': 'any' } });

    const response = await admitting(request);

    expect(response.status).toBe(200);
  });

  test('a request without x-api-key is answered INVALID_INPUT', async () => {
    const request = aRequest(`/orders/${PAID_ORDER_ID}`);

    const response = await http(request);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      rejection: {
        code: 'INVALID_INPUT',
        body: { issues: [{ in: 'headers', path: ['x-api-key'], code: 'required' }] },
      },
    });
  });

  test('an unknown key is answered UNAUTHENTICATED', async () => {
    const request = aRequest(`/orders/${PAID_ORDER_ID}`, { headers: { 'x-api-key': 'stolen' } });

    const response = await http(request);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      rejection: { code: 'UNAUTHENTICATED', message: 'The API key is unknown' },
    });
  });

  test('a placed order is answered 201', async () => {
    const body = { customerId: CUSTOMER_ID, total: { amount: 990, currency: 'EUR' } };
    const request = aRequest('/orders', {
      method: 'POST',
      headers: { 'x-api-key': 'billing-key', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

    const response = await http(request);

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ ...body, status: 'pending' });
  });

  test('a body that is no JSON is answered INVALID_INPUT, malformed', async () => {
    const request = aRequest('/orders', {
      method: 'POST',
      headers: { 'x-api-key': 'billing-key', 'content-type': 'application/json' },
      body: '{"customerId":',
    });

    const response = await http(request);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      rejection: { code: 'INVALID_INPUT', body: { issues: [{ in: 'body', code: 'malformed' }] } },
    });
  });

  test('the Private health Endpoint needs no key', async () => {
    const response = await http(aRequest('/health'));

    expect(await response.json()).toEqual({ up: true });
  });

  test('a path no Endpoint declares is answered NO_SUCH_ENDPOINT', async () => {
    const response = await http(aRequest('/invoices'));

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ fault: { code: 'NO_SUCH_ENDPOINT' } });
  });
});
