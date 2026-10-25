import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { type ContractPackage, defineDependency, defineEndpoint, defineEvent } from '../index.ts';
import { providerExportsOf } from '../internal/index.ts';

const getPayment = defineEndpoint({
  name: 'getPayment',
  method: 'GET',
  path: '/payments',
  visibility: 'public',
  description: 'Every payment',
  success: { status: 200, body: z.object({ amount: z.int() }) },
});

const paymentSettledV1 = defineEvent({
  name: 'PaymentSettled',
  version: 1,
  visibility: 'internal',
  description: 'A payment was settled',
  body: z.object({ paymentId: z.uuid() }),
});

const payments = {
  name: 'payments-service',
  version: '5.1.0',
  endpoints: { getPayment },
  events: { paymentSettledV1 },
  standardRejections: {
    invalidInput: { code: 'INVALID_INPUT', status: 400, message: 'Invalid input' },
    notFound: { code: 'NOT_FOUND', status: 404, message: 'Not found' },
    notImplemented: { code: 'NOT_IMPLEMENTED', status: 501, message: 'Not implemented' },
  },
  exportedSnapshot: { format: 1, defs: {}, endpoints: {}, events: {}, guards: {}, codes: {} },
} as const satisfies ContractPackage;

describe('providerExportsOf', () => {
  test('a Dependency’s Provider exports its Endpoints and its Events, each by identity', () => {
    const dependency = defineDependency({ provider: payments, endpoints: [getPayment] });

    const exported = providerExportsOf(dependency);

    expect(exported.endpoints).toEqual([getPayment]);
    expect(exported.endpoints[0]).toBe(getPayment);
    expect(exported.events[0]).toBe(paymentSettledV1);
  });

  test('a Contract Package a cast left without Events or Endpoints exports none of them', () => {
    const { events: _events, endpoints: _endpoints, ...cast } = payments;
    const dependency = defineDependency({ provider: payments });

    const exported = providerExportsOf({
      ...dependency,
      provider: cast as unknown as typeof payments,
    });

    expect(exported).toEqual({ endpoints: [], events: [] });
  });
});
