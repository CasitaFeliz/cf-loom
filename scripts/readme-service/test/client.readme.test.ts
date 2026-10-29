import { serve } from '@cf-loom/server';
import { fakeProvider } from '@cf-loom/testing';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { contract as paymentsContract } from '../payments-service/src/contract/index.ts';
import paymentsHandlers from '../payments-service/src/handlers.generated.ts';
import { resetPayments, resources, stored } from '../payments-service/src/resources.ts';
import { pay } from '../snippets/client-retrying.ts';
import { paymentsDependency } from '../src/contract/dependencies/payments-service.dependency.ts';
import { amountOf } from '../src/payments/amount-of.ts';
import { baseUrl, settings } from '../src/service-code.ts';
import { payments as adminPayments } from '../web-admin/src/payments.ts';
import { apiKey } from '../web-admin/src/session.ts';

beforeEach(resetPayments);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** A payments-service fake whose createPayment answers 503 with `retryAfter`, then its Success. */
function busyOnce(retryAfter: string) {
  const provider = fakeProvider(paymentsDependency, { baseUrl });
  provider
    .on('createPayment')
    .once((r) => r.status(503, { 'retry-after': retryAfter }))
    .otherwise((r, { body }) => r.success({ id: 'p-1', amount: body.amount }));
  vi.stubGlobal('fetch', provider.fetch);
  return provider;
}

describe('the client README’s Consuming a Contract', () => {
  test('amountOf answers a Success’s amount, and null for NOT_FOUND and for a retryable Fault nothing committed', async () => {
    const provider = fakeProvider(paymentsDependency, { baseUrl });
    provider
      .on('getPayment')
      .once((r, { params }) => r.success({ id: params.paymentId, amount: 1200 }))
      .once((r) => r.reject('NOT_FOUND'))
      .once((r) => r.fault({ committed: 'no', retryable: true }));
    vi.stubGlobal('fetch', provider.fetch);

    const amounts = [await amountOf('pay-1'), await amountOf('pay-2'), await amountOf('pay-3')];

    expect(amounts).toEqual([1200, null, null]);
    expect(provider.calls('getPayment')).toMatchObject([
      { headers: { 'x-api-key': settings.paymentsKey } },
      {},
      {},
    ]);
  });
});

describe('the client README’s Retrying', () => {
  test('pay retries a timed-out createPayment with the same idempotency key, and the Provider stores one payment', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const http = serve(paymentsContract, paymentsHandlers, { resources });
    const keys: (string | null)[] = [];
    vi.stubGlobal('fetch', async (request: Request) => {
      keys.push(request.headers.get('idempotency-key'));
      const response = await http(request);
      if (keys.length === 1) {
        throw new DOMException('The operation timed out', 'TimeoutError');
      }
      return response;
    });

    const paying = pay(1200);
    await vi.runAllTimersAsync();
    const outcome = await paying;

    expect(outcome).toEqual({ kind: 'success', status: 201, body: { id: 'p-1', amount: 1200 } });
    expect(keys).toEqual([keys[0], keys[0]]);
    expect([...stored.values()]).toEqual([{ id: 'p-1', amount: 1200 }]);
  });

  test('pay waits the seconds Retry-After gives before it retries', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const provider = busyOnce('3');

    const paying = pay(1200);
    await vi.advanceTimersByTimeAsync(2_999);
    const callsBefore = provider.calls('createPayment').length;
    await vi.advanceTimersByTimeAsync(1);
    const outcome = await paying;

    expect(callsBefore).toBe(1);
    expect(outcome).toMatchObject({ kind: 'success', status: 201 });
    expect(provider.calls('createPayment')).toHaveLength(2);
  });

  test('pay waits until the HTTP date Retry-After names', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] });
    vi.setSystemTime(new Date('2026-10-27T10:00:00Z'));
    const provider = busyOnce('Tue, 27 Oct 2026 10:00:05 GMT');

    const paying = pay(1200);
    await vi.advanceTimersByTimeAsync(4_999);
    const callsBefore = provider.calls('createPayment').length;
    await vi.advanceTimersByTimeAsync(1);
    const outcome = await paying;

    expect(callsBefore).toBe(1);
    expect(outcome).toMatchObject({ kind: 'success', status: 201 });
    expect(provider.calls('createPayment')).toHaveLength(2);
  });

  test('pay waits one second when Retry-After is neither seconds nor a date', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const provider = busyOnce('soon');

    const paying = pay(1200);
    await vi.advanceTimersByTimeAsync(999);
    const callsBefore = provider.calls('createPayment').length;
    await vi.advanceTimersByTimeAsync(1);
    const outcome = await paying;

    expect(callsBefore).toBe(1);
    expect(outcome).toMatchObject({ kind: 'success', status: 201 });
    expect(provider.calls('createPayment')).toHaveLength(2);
  });
});

describe('the client README’s In a browser', () => {
  test('the browser client sends each call with credentials included', async () => {
    const sent: Request[] = [];
    vi.stubGlobal('fetch', async (request: Request) => {
      sent.push(request);
      return Response.json({ id: 'pay-1', amount: 1200 });
    });

    await adminPayments.getPayment({ params: { paymentId: 'pay-1' } });

    expect(sent.map((request) => request.credentials)).toEqual(['include']);
    expect(sent[0]?.headers.get('x-api-key')).toBe(apiKey);
  });
});
