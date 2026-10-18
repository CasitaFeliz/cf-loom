import { describe, expect, expectTypeOf, test } from 'vitest';
import { z } from 'zod';
import { type ContractPackage, defineDependencies, defineEndpoint } from './index.ts';

const getPayment = defineEndpoint({
  name: 'getPayment',
  method: 'GET',
  path: '/payments/:paymentId',
  visibility: 'public',
  description: 'One payment by id',
  input: { params: z.object({ paymentId: z.uuid() }) },
  success: { status: 200, body: z.object({ amount: z.int() }) },
});

const refundPayment = defineEndpoint({
  name: 'refundPayment',
  method: 'POST',
  path: '/payments/:paymentId/refund',
  visibility: 'internal',
  description: 'Refunds a payment',
  input: { params: z.object({ paymentId: z.uuid() }) },
  success: { status: 204 },
});

const paymentSettledV1 = {
  kind: 'event',
  name: 'PaymentSettled',
  version: 1,
  visibility: 'internal',
} as const;

const payments = {
  name: 'payments-service',
  version: '5.1.0',
  endpoints: { getPayment, refundPayment },
  events: { paymentSettledV1 },
  standardRejections: {
    invalidInput: { code: 'INVALID_INPUT', status: 400, message: 'Invalid input' },
    notFound: { code: 'NOT_FOUND', status: 404, message: 'Not found' },
    notImplemented: { code: 'NOT_IMPLEMENTED', status: 501, message: 'Not implemented' },
  },
} as const satisfies ContractPackage;

describe('defineDependencies', () => {
  test('a Dependency records its Provider’s name and version', () => {
    const paymentsDeps = defineDependencies(payments, { endpoints: [getPayment] });

    expect(paymentsDeps.provider).toBe('payments-service');
    expect(paymentsDeps.against).toBe('5.1.0');
    expect(paymentsDeps.standardRejections).toBe(payments.standardRejections);
  });

  test('a Dependency exposes the selected Endpoints and Events by name', () => {
    const paymentsDeps = defineDependencies(payments, {
      endpoints: [payments.endpoints.getPayment],
      events: [payments.events.paymentSettledV1],
    });

    expect(paymentsDeps.endpoints).toEqual({ getPayment });
    expect(paymentsDeps.events).toEqual({ paymentSettledV1 });
    expectTypeOf(paymentsDeps.endpoints).toEqualTypeOf<{
      readonly getPayment: typeof getPayment;
    }>();
    expectTypeOf(paymentsDeps.events).toEqualTypeOf<{
      readonly paymentSettledV1: typeof paymentSettledV1;
    }>();
  });

  test('a Contract Package exports only Public and Internal Elements', () => {
    const healthCheck = defineEndpoint({
      name: 'healthCheck',
      method: 'GET',
      path: '/health',
      visibility: 'private',
      description: 'Whether the Service is up',
      success: { status: 204 },
    });

    const declare = () =>
      defineDependencies(
        // @ts-expect-error a Private Endpoint is never exported
        { ...payments, endpoints: { healthCheck } },
        { endpoints: [healthCheck] },
      );

    expect(declare).not.toThrow();
  });

  test('a Dependency selects only its Provider’s Elements', () => {
    const getReceipt = defineEndpoint({
      name: 'getReceipt',
      method: 'GET',
      path: '/receipts',
      visibility: 'public',
      description: 'The latest receipt',
      success: { status: 200, body: z.object({ amount: z.int() }) },
    });

    const declare = () =>
      // @ts-expect-error the Provider has no such Endpoint
      defineDependencies(payments, { endpoints: [getReceipt] });

    expect(declare).not.toThrow();
  });
});
