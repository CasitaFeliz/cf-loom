import { describe, expect, expectTypeOf, test } from 'vitest';
import { z } from 'zod';
import { type ContractPackage, defineDependency, defineEndpoint, defineEvent } from '../index.ts';

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
  endpoints: { getPayment, refundPayment },
  events: { paymentSettledV1 },
  standardRejections: {
    invalidInput: { code: 'INVALID_INPUT', status: 400, message: 'Invalid input' },
    notFound: { code: 'NOT_FOUND', status: 404, message: 'Not found' },
    notImplemented: { code: 'NOT_IMPLEMENTED', status: 501, message: 'Not implemented' },
  },
  exportedSnapshot: { format: 1, defs: {}, endpoints: {}, events: {}, guards: {}, codes: {} },
} as const satisfies ContractPackage;

describe('defineDependency', () => {
  test('a Dependency keeps its Provider’s Contract Package and the selected Endpoints as listed', () => {
    const paymentsDependency = defineDependency({
      provider: payments,
      endpoints: [payments.endpoints.getPayment],
    });

    expect(paymentsDependency.kind).toBe('dependency');
    expect(paymentsDependency.provider).toEqual(payments);
    expect(paymentsDependency.endpoints).toEqual([getPayment]);
    expect(paymentsDependency.endpoints[0]).toBe(getPayment);
    expectTypeOf(paymentsDependency.endpoints).toEqualTypeOf<readonly [typeof getPayment]>();
  });

  test('a Dependency keeps the Elements its Provider exports, by identity', () => {
    const paymentsDependency = defineDependency({ provider: payments, endpoints: [getPayment] });

    expect(paymentsDependency.provider.endpoints.refundPayment).toBe(refundPayment);
    expect(paymentsDependency.provider.events.paymentSettledV1).toBe(paymentSettledV1);
  });

  test('a Dependency keeps its Provider’s Standard codes as literals, so a Caller narrows by them', () => {
    const paymentsDependency = defineDependency({ provider: payments, endpoints: [getPayment] });

    const { standardRejections } = paymentsDependency.provider;
    expectTypeOf(standardRejections.notFound.code).toEqualTypeOf<'NOT_FOUND'>();
    expectTypeOf(standardRejections.invalidInput.code).toEqualTypeOf<'INVALID_INPUT'>();
    expect(standardRejections.notFound.code).toBe('NOT_FOUND');
  });

  test('a Dependency that selects no Endpoint holds no list', () => {
    const paymentsDependency = defineDependency({ provider: payments });

    expect(paymentsDependency).not.toHaveProperty('endpoints');
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
      defineDependency({
        // @ts-expect-error a Private Endpoint is never exported
        provider: { ...payments, endpoints: { healthCheck } },
        // @ts-expect-error nor selected
        endpoints: [healthCheck],
      });

    expect(declare).not.toThrow();
  });

  test('an Endpoint the Provider does not export is a type error', () => {
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
      defineDependency({ provider: payments, endpoints: [getReceipt] });

    expect(declare).not.toThrow();
  });
});

describe('defineDependency fields', () => {
  test('events is a type error: a Subscription takes its Event from the Contract Package', () => {
    const declare = () =>
      defineDependency({
        provider: payments,
        // @ts-expect-error a Dependency selects Endpoints only
        events: [paymentSettledV1],
      });

    expect(declare).not.toThrow();
  });

  test.each([
    { what: 'an Endpoint written undefined', declaration: { endpoints: [undefined] } },
    { what: 'endpoints written null', declaration: { endpoints: null } },
    { what: 'a provider left undefined', declaration: { provider: undefined } },
    { what: 'a provider written null', declaration: { provider: null, endpoints: [getPayment] } },
    // biome-ignore lint/suspicious/noSparseArray: the hole is what the test writes
    { what: 'a hole in the list', declaration: { endpoints: [, getPayment] } },
  ])('$what does not throw, leaving it to generate to report', ({ declaration }) => {
    const written = { provider: payments, ...declaration } as unknown as Parameters<
      typeof defineDependency
    >[0];

    expect(() => defineDependency(written)).not.toThrow();
  });
});

describe('a declared Dependency’s containers', () => {
  test('a Dependency freezes itself, its list of Endpoints and its Contract Package', () => {
    const paymentsDependency = defineDependency({ provider: payments, endpoints: [getPayment] });

    expect(Object.isFrozen(paymentsDependency)).toBe(true);
    expect(Object.isFrozen(paymentsDependency.endpoints)).toBe(true);
    expect(Object.isFrozen(paymentsDependency.provider)).toBe(true);
    expect(paymentsDependency.endpoints[0]).toBe(getPayment);
  });
});
