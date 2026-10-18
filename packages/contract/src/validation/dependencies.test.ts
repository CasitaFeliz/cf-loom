import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import {
  type Application,
  type ContractPackage,
  type Dependencies,
  defineApplication,
  defineContract,
  defineDependencies,
  defineEndpoint,
} from '../index.ts';
import { validateContract } from '../internal/index.ts';

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

const healthCheck = defineEndpoint({
  name: 'healthCheck',
  method: 'GET',
  path: '/health',
  visibility: 'private',
  description: 'Whether the Service is up',
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

/** A Dependency as a cast lets an author select what the Provider does not export. */
function dependingOn(selection: { endpoints?: object; events?: object }): Dependencies {
  const paymentsDeps = defineDependencies(payments, {});
  return { ...paymentsDeps, endpoints: {}, events: {}, ...selection } as Dependencies;
}

function failed(at: readonly (string | number)[], rule: string, message: string) {
  return { kind: 'invalid', failures: [{ at, rule, message }] };
}

describe('validateContract: a Service’s Dependencies', () => {
  test('a Dependency on Public and Internal Endpoints and an Event validates', () => {
    const paymentsDeps = defineDependencies(payments, {
      endpoints: [getPayment, refundPayment],
      events: [paymentSettledV1],
    });
    const contract = defineContract({ name: 'orders-service', dependencies: [paymentsDeps] });

    expect(validateContract(contract, noOrigin).kind).toBe('valid');
  });

  test('a Dependency on a Private Endpoint fails', () => {
    const paymentsDeps = dependingOn({ endpoints: { healthCheck } });
    const contract = defineContract({ name: 'orders-service', dependencies: [paymentsDeps] });

    expect(validateContract(contract, noOrigin)).toEqual(
      failed(
        ['dependencies', 'payments-service', 'endpoints', 'healthCheck'],
        'dependency-selection',
        'A Dependency selects Elements its Provider exports: healthCheck is private',
      ),
    );
  });

  test('a Dependency on something that is not an Endpoint fails', () => {
    const paymentsDeps = dependingOn({ endpoints: { getPayment: { name: 'getPayment' } } });
    const contract = defineContract({ name: 'orders-service', dependencies: [paymentsDeps] });

    expect(validateContract(contract, noOrigin)).toEqual(
      failed(
        ['dependencies', 'payments-service', 'endpoints', 'getPayment'],
        'dependency-selection',
        'A Dependency selects Elements its Provider exports: getPayment is not an Endpoint',
      ),
    );
  });

  test('a Dependency on something that is not an Event fails', () => {
    const paymentsDeps = dependingOn({ events: { paymentSettledV1: { name: 'PaymentSettled' } } });
    const contract = defineContract({ name: 'orders-service', dependencies: [paymentsDeps] });

    expect(validateContract(contract, noOrigin)).toEqual(
      failed(
        ['dependencies', 'payments-service', 'events', 'paymentSettledV1'],
        'dependency-selection',
        'A Dependency selects Elements its Provider exports: paymentSettledV1 is not an Event',
      ),
    );
  });

  test('a Dependency on a Private Event fails', () => {
    const privateEvent = { ...paymentSettledV1, visibility: 'private' };
    const paymentsDeps = dependingOn({ events: { paymentSettledV1: privateEvent } });
    const contract = defineContract({ name: 'orders-service', dependencies: [paymentsDeps] });

    expect(validateContract(contract, noOrigin)).toEqual(
      failed(
        ['dependencies', 'payments-service', 'events', 'paymentSettledV1'],
        'dependency-selection',
        'A Dependency selects Elements its Provider exports: paymentSettledV1 is private',
      ),
    );
  });
});

describe('validateContract: an Application’s Dependencies', () => {
  test('an Application depending on Public Endpoints validates', () => {
    const paymentsDeps = defineDependencies(payments, { endpoints: [getPayment] });
    const application = defineApplication({ name: 'web-admin', dependencies: [paymentsDeps] });

    expect(validateContract(application, noOrigin).kind).toBe('valid');
  });

  test('an Application depending on an Internal Endpoint fails', () => {
    const paymentsDeps = dependingOn({ endpoints: { refundPayment } });
    const application = {
      kind: 'application',
      name: 'web-admin',
      dependencies: [paymentsDeps],
    } as unknown as Application;

    expect(validateContract(application, noOrigin)).toEqual(
      failed(
        ['dependencies', 'payments-service', 'endpoints', 'refundPayment'],
        'application-dependency',
        'An Application depends on Public Endpoints only: refundPayment is internal',
      ),
    );
  });

  test('an Application depending on an Event fails', () => {
    const paymentsDeps = dependingOn({ events: { paymentSettledV1 } });
    const application = {
      kind: 'application',
      name: 'web-admin',
      dependencies: [paymentsDeps],
    } as unknown as Application;

    expect(validateContract(application, noOrigin)).toEqual(
      failed(
        ['dependencies', 'payments-service', 'events', 'paymentSettledV1'],
        'application-dependency',
        'An Application subscribes to no Event: paymentSettledV1',
      ),
    );
  });
});
