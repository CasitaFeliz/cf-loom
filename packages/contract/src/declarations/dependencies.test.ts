import { describe, expect, expectTypeOf, test } from 'vitest';
import { z } from 'zod';
import { type ContractPackage, defineDependencies, defineEndpoint, defineEvent } from '../index.ts';
import { codeNameOf } from '../internal/index.ts';

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

describe('defineDependencies', () => {
  test('a Dependency records its Provider’s name and version', () => {
    const paymentsDeps = defineDependencies(payments, { endpoints: [getPayment] });

    expect(paymentsDeps.provider).toBe('payments-service');
    expect(paymentsDeps.against).toBe('5.1.0');
    expect(paymentsDeps.standardRejections).toEqual(payments.standardRejections);
  });

  test('a Dependency keeps its Provider’s Standard codes as literals, so a Caller narrows by them', () => {
    const paymentsDeps = defineDependencies(payments, { endpoints: [getPayment] });

    expectTypeOf(paymentsDeps.standardRejections.notFound.code).toEqualTypeOf<'NOT_FOUND'>();
    expectTypeOf(
      paymentsDeps.standardRejections.invalidInput.code,
    ).toEqualTypeOf<'INVALID_INPUT'>();
    expect(paymentsDeps.standardRejections.notFound.code).toBe('NOT_FOUND');
  });

  test('a Dependency keeps its Provider’s exported Snapshot, for its client to read nodes from', () => {
    const paymentsDeps = defineDependencies(payments, { endpoints: [getPayment] });

    expect(paymentsDeps.exportedSnapshot).toEqual(payments.exportedSnapshot);
  });

  test('a Dependency keeps the Elements its Provider exports, by identity', () => {
    const paymentsDeps = defineDependencies(payments, { endpoints: [getPayment] });

    const { getPayment: exportedGetPayment, refundPayment: exportedRefund } =
      paymentsDeps.exported.endpoints;
    expect(exportedGetPayment).toBe(getPayment);
    expect(exportedRefund).toBe(refundPayment);
    expect(paymentsDeps.exported.events).toEqual({ paymentSettledV1 });
  });

  test('a Dependency exposes the selected Endpoints and Events by name', () => {
    const paymentsDeps = defineDependencies(payments, {
      endpoints: [payments.endpoints.getPayment],
      events: [payments.events.paymentSettledV1],
    });

    expect(paymentsDeps.endpoints).toEqual({ getPayment });
    expect(paymentsDeps.events).toEqual({ paymentSettledV1 });
    expect(paymentsDeps.events.paymentSettledV1).toBe(paymentSettledV1);
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

describe('defineDependencies fields', () => {
  test('an undeclared field is a type error', () => {
    const declare = () =>
      // @ts-expect-error a Dependency selects Endpoints and Events only
      defineDependencies(payments, { endpoints: [getPayment], commands: [] });

    expect(declare).not.toThrow();
  });
});

describe('a declared Dependency’s containers', () => {
  test('a Dependency freezes its maps of Endpoints and Events', () => {
    const paymentsDeps = defineDependencies(payments, {
      endpoints: [getPayment],
      events: [paymentSettledV1],
    });

    expect(Object.isFrozen(paymentsDeps)).toBe(true);
    expect(Object.isFrozen(paymentsDeps.endpoints)).toBe(true);
    expect(Object.isFrozen(paymentsDeps.events)).toBe(true);
    expect(paymentsDeps.endpoints.getPayment).toBe(getPayment);
  });
});

describe('a Dependency on an Endpoint named kind', () => {
  test('a Dependency freezes its map of Endpoints even when an Endpoint is named kind', () => {
    const kind = defineEndpoint({
      name: 'kind',
      method: 'GET',
      path: '/kinds',
      visibility: 'public',
      description: 'Every kind of payment',
      success: { status: 200, body: z.array(z.string()) },
    });
    const provider = { ...payments, endpoints: { kind } } as const satisfies ContractPackage;

    const paymentsDeps = defineDependencies(provider, { endpoints: [kind] });

    expect(Object.isFrozen(paymentsDeps.endpoints)).toBe(true);
    expect(paymentsDeps.endpoints.kind).toBe(kind);
  });
});

describe('codeNameOf', () => {
  test('a Message Version’s name in code lower-cases its first letter and appends V and its version', () => {
    const message = { name: 'OrderCreated', version: 12 };

    const name = codeNameOf(message);

    expect(name).toBe('orderCreatedV12');
  });
});
