import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import {
  type ContractPackage,
  defineApplication,
  defineContract,
  defineDefinitions,
  defineDependencies,
  defineEndpoint,
  defineGroup,
} from './index.ts';

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

describe('defineContract', () => {
  test('a Contract keeps what its root lists by identity', () => {
    const definitions = defineDefinitions({ name: 'definitions' });
    const paymentsGroup = defineGroup({
      name: 'payments',
      description: 'Payments',
      endpoints: [getPayment],
    });
    const paymentsDeps = defineDependencies(payments, { endpoints: [refundPayment] });

    const contract = defineContract({
      name: 'orders-service',
      definitions: [definitions],
      groups: [paymentsGroup],
      dependencies: [paymentsDeps],
    });

    expect(contract.groups[0]).toBe(paymentsGroup);
    expect(contract.definitions[0]).toBe(definitions);
    expect(contract.dependencies[0]).toBe(paymentsDeps);
    expect(contract.kind).toBe('contract');
  });
});

describe('defineApplication', () => {
  test('an Application may depend only on Public Endpoints', () => {
    const publicDeps = defineDependencies(payments, { endpoints: [getPayment] });
    const internalDeps = defineDependencies(payments, { endpoints: [refundPayment] });
    const eventDeps = defineDependencies(payments, { events: [paymentSettledV1] });

    const declare = () => [
      defineApplication({ name: 'web-admin', dependencies: [publicDeps] }),
      // @ts-expect-error an Application runs outside the internal network
      defineApplication({ name: 'web-admin', dependencies: [internalDeps] }),
      // @ts-expect-error an Application subscribes to no Event
      defineApplication({ name: 'web-admin', dependencies: [eventDeps] }),
    ];

    expect(declare).not.toThrow();
  });
});

describe('the roots’ fields', () => {
  test('an undeclared field on a Contract is a type error', () => {
    // @ts-expect-error events come with the messaging declarations
    const declare = () => defineContract({ name: 'orders-service', events: [] });

    expect(declare).not.toThrow();
  });

  test('an undeclared field on an Application is a type error', () => {
    const declare = () =>
      // @ts-expect-error an Application offers no Endpoints
      defineApplication({ name: 'web-admin', dependencies: [], groups: [] });

    expect(declare).not.toThrow();
  });
});

describe('a declared root’s containers', () => {
  test('a Contract freezes its lists', () => {
    const groups = [
      defineGroup({ name: 'payments', description: 'Payments', endpoints: [getPayment] }),
    ];

    const contract = defineContract({ name: 'payments-service', groups, definitions: [] });
    groups.pop();

    expect(contract.groups).toHaveLength(1);
    expect(Object.isFrozen(contract.groups)).toBe(true);
    expect(Object.isFrozen(contract.definitions)).toBe(true);
  });

  test('an Application freezes its list of Dependencies', () => {
    const application = defineApplication({ name: 'web-admin', dependencies: [] });

    expect(Object.isFrozen(application.dependencies)).toBe(true);
  });
});
