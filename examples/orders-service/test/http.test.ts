import { admit, handle } from '@cf-loom/handlers';
import type { ConsumedFault, Messaging, MessagingOptions } from '@cf-loom/messaging';
import { memory } from '@cf-loom/messaging/memory';
import { type Http, type ServedFault, serve } from '@cf-loom/server';
import { apiKey } from '@org/definitions';
import { afterAll, beforeAll, describe, expect, expectTypeOf, test } from 'vitest';
import { contract } from '../src/contract/index.ts';
import handlers from '../src/handlers.generated.ts';
import type { Resources } from '../src/resources.ts';

const PAID_ORDER_ID = '7d4f0a52-3c1b-4e8a-9f6d-1a2b3c4d5e6f';
const UNKNOWN_ORDER_ID = '00000000-0000-4000-8000-000000000000';
const CUSTOMER_ID = '9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';
let running: Messaging<typeof contract>;
let resources: Resources;
let http: Http;

beforeAll(async () => {
  running = await memory(contract);
  resources = { publisher: running.publisher, sender: running.sender };
  http = serve(contract, handlers, { resources, onServiceFault: () => undefined });
});

afterAll(async () => {
  await running.close();
});

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
    const anyKey = handle(apiKey, async () => admit(apiKey, { callerId: 'test' }));
    const admitting = serve(
      contract,
      { ...handlers, guards: { ...handlers.guards, apiKey: anyKey } },
      { resources },
    );
    const request = aRequest(`/orders/${PAID_ORDER_ID}`, { headers: { 'x-api-key': 'any' } });

    const response = await admitting(request);

    expect(response.status).toBe(200);
  });

  test('a request without x-api-key is answered UNAUTHENTICATED by orders’ GuardHandler', async () => {
    const request = aRequest(`/orders/${PAID_ORDER_ID}`);

    const response = await http(request);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      rejection: { code: 'UNAUTHENTICATED', message: 'The API key is missing or unknown' },
    });
  });

  test('the 401 carries the www-authenticate header @org/definitions’ UNAUTHENTICATED declares', async () => {
    const request = aRequest(`/orders/${PAID_ORDER_ID}`);

    const response = await http(request);

    expect(response.headers.get('www-authenticate')).toBe('ApiKey realm="orders-service"');
  });

  test('an unknown key is answered UNAUTHENTICATED', async () => {
    const request = aRequest(`/orders/${PAID_ORDER_ID}`, { headers: { 'x-api-key': 'stolen' } });

    const response = await http(request);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      rejection: { code: 'UNAUTHENTICATED', message: 'The API key is missing or unknown' },
    });
  });

  test('an order nobody placed is answered RESOURCE_NOT_FOUND with @org/definitions’ message', async () => {
    const request = aRequest(`/orders/${UNKNOWN_ORDER_ID}`, {
      headers: { 'x-api-key': 'billing-key' },
    });

    const response = await http(request);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      rejection: { code: 'RESOURCE_NOT_FOUND', message: 'The resource does not exist' },
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

  test('a body that is no JSON is answered BAD_REQUEST, malformed, with @org/definitions’ message', async () => {
    const request = aRequest('/orders', {
      method: 'POST',
      headers: { 'x-api-key': 'billing-key', 'content-type': 'application/json' },
      body: '{"customerId":',
    });

    const response = await http(request);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      rejection: {
        code: 'BAD_REQUEST',
        message: 'The request is invalid',
        body: { issues: [{ in: 'body', code: 'malformed' }] },
      },
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

describe('onServiceFault', () => {
  test('one async hook for ServedFault and ConsumedFault is accepted by both serve and messaging', () => {
    const onServiceFault = async (fault: ServedFault | ConsumedFault): Promise<void> => {
      expectTypeOf(fault.name).toEqualTypeOf<string>();
    };

    const served = serve(contract, handlers, { resources, onServiceFault });

    expectTypeOf(onServiceFault).toExtend<NonNullable<MessagingOptions['onServiceFault']>>();
    expect(typeof served).toBe('function');
  });
});
