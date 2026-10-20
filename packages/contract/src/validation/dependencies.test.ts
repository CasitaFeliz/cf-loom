import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import {
  type ContractPackage,
  defineApplication,
  defineContract,
  defineDependencies,
  defineEndpoint,
} from '../index.ts';
import { type RootPackage, validateContract } from '../internal/index.ts';

/** Validates a root as the package it names: its package.json named as the root is. */
function validateInPackage(root: unknown, originOf: RootPackage['originOf']) {
  const name = typeof root === 'object' && root !== null ? Reflect.get(root, 'name') : undefined;
  const packageName = typeof name === 'string' ? name : '';
  return validateContract(root, { originOf, packageName, exportsOf: () => [] });
}

function noOrigin() {
  return undefined;
}

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

const getReceipt = defineEndpoint({
  name: 'getReceipt',
  method: 'GET',
  path: '/receipts',
  visibility: 'public',
  description: 'The latest receipt',
  success: { status: 200, body: z.object({ amount: z.int() }) },
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
  exportedSnapshot: { format: 1, defs: {}, endpoints: {}, guards: {}, codes: {} },
} as const satisfies ContractPackage;

/** A selection the types refuse, as a cast lets an author write it. */
type AnySelection = { readonly endpoints?: readonly (typeof getPayment)[] };

function failed(at: readonly (string | number)[], rule: string, message: string) {
  return { kind: 'invalid', failures: [{ kind: 'declaration', at, rule, message }] };
}

describe('validateContract: a Service’s Dependencies', () => {
  test('a Dependency on Public and Internal Endpoints and an Event validates', () => {
    const paymentsDeps = defineDependencies(payments, {
      endpoints: [getPayment, refundPayment],
      events: [paymentSettledV1],
    });
    const contract = defineContract({ name: 'orders-service', dependencies: [paymentsDeps] });

    expect(validateInPackage(contract, noOrigin).kind).toBe('valid');
  });

  test('a Dependency on an Endpoint the Provider does not export fails', () => {
    const selection = { endpoints: [getReceipt] } as unknown as AnySelection;
    const paymentsDeps = defineDependencies(payments, selection);
    const contract = defineContract({ name: 'orders-service', dependencies: [paymentsDeps] });

    expect(validateInPackage(contract, noOrigin)).toEqual(
      failed(
        ['dependencies', 'payments-service', 'endpoints', 'getReceipt'],
        'dependency-selection',
        'A Dependency selects Elements its Provider exports: getReceipt is not one of them',
      ),
    );
  });

  test('a Dependency on a Private Endpoint fails, even one the Provider exported', () => {
    const healthCheck = defineEndpoint({
      name: 'healthCheck',
      method: 'GET',
      path: '/health',
      visibility: 'private',
      description: 'Whether the Service is up',
      success: { status: 204 },
    });
    const provider = { ...payments, endpoints: { healthCheck } } as unknown as ContractPackage;
    const selection = { endpoints: [healthCheck] } as unknown as AnySelection;
    const paymentsDeps = defineDependencies(provider, selection);
    const contract = defineContract({ name: 'orders-service', dependencies: [paymentsDeps] });

    expect(validateInPackage(contract, noOrigin)).toEqual(
      failed(
        ['dependencies', 'payments-service', 'endpoints', 'healthCheck'],
        'dependency-selection',
        'A Dependency selects Elements its Provider exports: healthCheck is private',
      ),
    );
  });

  test('a Dependency on a Private Event fails, even one the Provider exported', () => {
    const privateEvent = { ...paymentSettledV1, visibility: 'private' };
    const provider = {
      ...payments,
      events: { paymentSettledV1: privateEvent },
    } as unknown as ContractPackage;
    const paymentsDeps = defineDependencies(provider, {
      events: [privateEvent],
    } as unknown as AnySelection);
    const contract = defineContract({ name: 'orders-service', dependencies: [paymentsDeps] });

    expect(validateInPackage(contract, noOrigin)).toEqual(
      failed(
        ['dependencies', 'payments-service', 'events', 'paymentSettledV1'],
        'dependency-selection',
        'A Dependency selects Elements its Provider exports: paymentSettledV1 is private',
      ),
    );
  });

  test('a Dependency on something that is not an Endpoint fails', () => {
    const selection = { endpoints: [{ name: 'getPayment' }] } as unknown as AnySelection;
    const paymentsDeps = defineDependencies(payments, selection);
    const contract = defineContract({ name: 'orders-service', dependencies: [paymentsDeps] });

    expect(validateInPackage(contract, noOrigin)).toEqual(
      failed(
        ['dependencies', 'payments-service', 'endpoints', 'getPayment'],
        'dependency-selection',
        'A Dependency selects Elements its Provider exports: getPayment is not an Endpoint',
      ),
    );
  });

  test('a Dependency on an Event the Provider does not export fails', () => {
    const paymentRefundedV1 = { ...paymentSettledV1, name: 'PaymentRefunded' };
    const selection = { events: [paymentRefundedV1] } as unknown as AnySelection;
    const paymentsDeps = defineDependencies(payments, selection);
    const contract = defineContract({ name: 'orders-service', dependencies: [paymentsDeps] });

    expect(validateInPackage(contract, noOrigin)).toEqual(
      failed(
        ['dependencies', 'payments-service', 'events', 'paymentRefundedV1'],
        'dependency-selection',
        'A Dependency selects Elements its Provider exports: paymentRefundedV1 is not one of them',
      ),
    );
  });

  test('two Dependencies on one Provider fail', () => {
    const first = defineDependencies(payments, { endpoints: [getPayment] });
    const second = defineDependencies(payments, { endpoints: [refundPayment] });
    const contract = defineContract({ name: 'orders-service', dependencies: [first, second] });

    expect(validateInPackage(contract, noOrigin)).toEqual(
      failed(
        ['dependencies', 'payments-service'],
        'duplicate-dependency',
        'A Contract lists one Dependency per Provider: payments-service',
      ),
    );
  });
});

describe('validateContract: a Dependency whose exported Elements are not there', () => {
  test('exported Endpoints written null fail once, as a required field', () => {
    const provider = { ...payments, endpoints: null } as unknown as ContractPackage;
    const selection = { endpoints: [getPayment, refundPayment] } as unknown as AnySelection;
    const paymentsDeps = defineDependencies(provider, selection);
    const contract = defineContract({ name: 'orders-service', dependencies: [paymentsDeps] });

    expect(validateInPackage(contract, noOrigin)).toEqual(
      failed(
        ['dependencies', 'payments-service', 'exported', 'endpoints'],
        'required-field',
        'endpoints is a required field',
      ),
    );
  });

  test('exported Events left out fail once, as a required field', () => {
    const provider = { ...payments, events: undefined } as unknown as ContractPackage;
    const selection = { events: [paymentSettledV1] } as unknown as AnySelection;
    const paymentsDeps = defineDependencies(provider, selection);
    const contract = defineContract({ name: 'orders-service', dependencies: [paymentsDeps] });

    expect(validateInPackage(contract, noOrigin)).toEqual(
      failed(
        ['dependencies', 'payments-service', 'exported', 'events'],
        'required-field',
        'events is a required field',
      ),
    );
  });
});

describe('validateContract: an Application’s Dependencies', () => {
  test('an Application depending on Public Endpoints validates', () => {
    const paymentsDeps = defineDependencies(payments, { endpoints: [getPayment] });
    const application = defineApplication({ name: 'web-admin', dependencies: [paymentsDeps] });

    expect(validateInPackage(application, noOrigin).kind).toBe('valid');
  });

  test('an Application depending on an Internal Endpoint fails', () => {
    const paymentsDeps = defineDependencies(payments, { endpoints: [refundPayment] });
    const dependencies = [paymentsDeps] as unknown as readonly [typeof publicDeps];
    const application = defineApplication({ name: 'web-admin', dependencies });

    expect(validateInPackage(application, noOrigin)).toEqual(
      failed(
        ['dependencies', 'payments-service', 'endpoints', 'refundPayment'],
        'application-dependency',
        'An Application depends on Public Endpoints only: refundPayment is internal',
      ),
    );
  });

  test('an Application depending on an Event fails', () => {
    const paymentsDeps = defineDependencies(payments, { events: [paymentSettledV1] });
    const dependencies = [paymentsDeps] as unknown as readonly [typeof publicDeps];
    const application = defineApplication({ name: 'web-admin', dependencies });

    expect(validateInPackage(application, noOrigin)).toEqual(
      failed(
        ['dependencies', 'payments-service', 'events', 'paymentSettledV1'],
        'application-dependency',
        'An Application subscribes to no Event: paymentSettledV1',
      ),
    );
  });
});

const publicDeps = defineDependencies(payments, { endpoints: [getPayment] });
