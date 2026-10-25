import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import {
  type ContractPackage,
  defineApplication,
  defineContract,
  defineDependency,
  defineEndpoint,
  defineEvent,
  defineGroup,
  defineSubscription,
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

/** A Dependency the types refuse, as a cast lets an author write it. */
function dependencyAsWritten(declaration: object) {
  return defineDependency(declaration as unknown as { readonly provider: typeof payments });
}

const notifyOnSettled = defineSubscription({
  name: 'notifyOnSettled',
  description: 'Notifies the customer of each payment settled',
  event: payments.events.paymentSettledV1,
});

const messages = defineGroup({
  name: 'messages',
  description: 'Messages',
  subscriptions: [notifyOnSettled],
});

function failed(at: readonly (string | number)[], rule: string, message: string) {
  return { kind: 'invalid', failures: [{ kind: 'declaration', at, rule, message }] };
}

describe('validateContract: a Service’s Dependencies', () => {
  test('a Dependency on Public and Internal Endpoints validates', () => {
    const paymentsDependency = defineDependency({
      provider: payments,
      endpoints: [getPayment, refundPayment],
    });
    const contract = defineContract({
      name: 'orders-service',
      dependencies: [paymentsDependency],
    });

    expect(validateInPackage(contract, noOrigin).kind).toBe('valid');
  });

  test('a Dependency only a Subscription uses, through its Provider’s Event, validates', () => {
    const paymentsDependency = defineDependency({ provider: payments });
    const contract = defineContract({
      name: 'orders-service',
      groups: [messages],
      dependencies: [paymentsDependency],
    });

    expect(validateInPackage(contract, noOrigin).kind).toBe('valid');
  });

  test('a Dependency that selects no Endpoint and whose Event no Subscription receives fails', () => {
    const paymentsDependency = defineDependency({ provider: payments, endpoints: [] });
    const contract = defineContract({ name: 'orders-service', dependencies: [paymentsDependency] });

    expect(validateInPackage(contract, noOrigin)).toEqual(
      failed(
        ['dependencies', 'payments-service'],
        'unused-dependency',
        "A Dependency is used: payments-service gives no Endpoint and no Subscription's Event",
      ),
    );
  });

  test('a second Dependency exporting a Subscription’s Event gives it nothing, so it is unused', () => {
    const mirror = { ...payments, name: 'mirror-service' };
    const contract = defineContract({
      name: 'orders-service',
      groups: [messages],
      dependencies: [
        defineDependency({ provider: payments }),
        dependencyAsWritten({ provider: mirror }),
      ],
    });

    expect(validateInPackage(contract, noOrigin)).toEqual(
      failed(
        ['dependencies', 'mirror-service'],
        'unused-dependency',
        "A Dependency is used: mirror-service gives no Endpoint and no Subscription's Event",
      ),
    );
  });

  test('a Dependency whose Provider bears the Service’s own name gives a Subscription to an own Event nothing, so it is unused', () => {
    const orderCreatedV1 = defineEvent({
      name: 'OrderCreated',
      version: 1,
      visibility: 'internal',
      description: 'An order was placed',
      body: z.object({ orderId: z.uuid() }),
    });
    const auditOrders = defineSubscription({
      name: 'auditOrders',
      description: 'Receives it',
      event: orderCreatedV1,
    });
    const orders = defineGroup({
      name: 'orders',
      description: 'Orders',
      events: [orderCreatedV1],
      subscriptions: [auditOrders],
    });
    const contract = defineContract({
      name: 'orders-service',
      groups: [orders],
      dependencies: [dependencyAsWritten({ provider: { ...payments, name: 'orders-service' } })],
    });

    expect(validateInPackage(contract, noOrigin)).toEqual(
      failed(
        ['dependencies', 'orders-service'],
        'unused-dependency',
        "A Dependency is used: orders-service gives no Endpoint and no Subscription's Event",
      ),
    );
  });

  test('a Dependency on an Endpoint the Provider does not export fails', () => {
    const paymentsDependency = dependencyAsWritten({ provider: payments, endpoints: [getReceipt] });
    const contract = defineContract({ name: 'orders-service', dependencies: [paymentsDependency] });

    expect(validateInPackage(contract, noOrigin)).toEqual(
      failed(
        ['dependencies', 'payments-service', 'endpoints', 0],
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
    const provider = { ...payments, endpoints: { healthCheck } };
    const paymentsDependency = dependencyAsWritten({ provider, endpoints: [healthCheck] });
    const contract = defineContract({ name: 'orders-service', dependencies: [paymentsDependency] });

    expect(validateInPackage(contract, noOrigin)).toEqual(
      failed(
        ['dependencies', 'payments-service', 'endpoints', 0],
        'dependency-selection',
        'A Dependency selects Elements its Provider exports: healthCheck is private',
      ),
    );
  });

  test('a Dependency on something that is not an Endpoint fails, by its position', () => {
    const endpoints = [getPayment, { name: 'refundPayment' }];
    const paymentsDependency = dependencyAsWritten({ provider: payments, endpoints });
    const contract = defineContract({ name: 'orders-service', dependencies: [paymentsDependency] });

    expect(validateInPackage(contract, noOrigin)).toEqual(
      failed(
        ['dependencies', 'payments-service', 'endpoints', 1],
        'not-a-declaration',
        'endpoints.1 is not an Endpoint',
      ),
    );
  });

  test('a Dependency holding events fails: a Subscription takes its Event from the Contract Package', () => {
    const paymentsDependency = dependencyAsWritten({
      provider: payments,
      endpoints: [getPayment],
      events: [paymentSettledV1],
    });
    const contract = defineContract({ name: 'orders-service', dependencies: [paymentsDependency] });

    expect(validateInPackage(contract, noOrigin)).toEqual(
      failed(
        ['dependencies', 'payments-service', 'events'],
        'undeclared-field',
        'events is not a declared field',
      ),
    );
  });

  test('an Endpoint listed twice in one Dependency fails at its second listing', () => {
    const paymentsDependency = dependencyAsWritten({
      provider: payments,
      endpoints: [getPayment, refundPayment, getPayment],
    });
    const contract = defineContract({ name: 'orders-service', dependencies: [paymentsDependency] });

    expect(validateInPackage(contract, noOrigin)).toEqual(
      failed(
        ['dependencies', 'payments-service', 'endpoints', 2],
        'dependency-selection',
        'A Dependency selects Elements its Provider exports: getPayment is listed twice',
      ),
    );
  });

  test('two Dependencies on one Provider fail', () => {
    const first = defineDependency({ provider: payments, endpoints: [getPayment] });
    const second = defineDependency({ provider: payments, endpoints: [refundPayment] });
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

describe('validateContract: a Dependency written as the types refuse', () => {
  test.each([
    {
      what: 'an Endpoint written undefined',
      declaration: { provider: payments, endpoints: [undefined] },
      line: {
        at: ['dependencies', 'payments-service', 'endpoints', 0],
        rule: 'not-a-declaration',
        message: 'endpoints.0 is not an Endpoint',
      },
    },
    {
      what: 'endpoints written null',
      declaration: { provider: payments, endpoints: null },
      line: {
        at: ['dependencies', 'payments-service', 'endpoints'],
        rule: 'not-a-list',
        message: 'endpoints is a list',
      },
    },
    {
      what: 'a hole where an Endpoint belongs',
      // biome-ignore lint/suspicious/noSparseArray: the hole is what the test writes
      declaration: { provider: payments, endpoints: [, getPayment] },
      line: {
        at: ['dependencies', 'payments-service', 'endpoints', 0],
        rule: 'not-a-declaration',
        message: 'endpoints.0 is not an Endpoint',
      },
    },
    {
      what: 'endpoints written as a map by name',
      declaration: { provider: payments, endpoints: { whatever: getPayment } },
      line: {
        at: ['dependencies', 'payments-service', 'endpoints'],
        rule: 'not-a-list',
        message: 'endpoints is a list',
      },
    },
    {
      what: 'endpoints written as an empty map',
      declaration: { provider: payments, endpoints: {} },
      line: {
        at: ['dependencies', 'payments-service', 'endpoints'],
        rule: 'not-a-list',
        message: 'endpoints is a list',
      },
    },
    {
      what: 'an Endpoint written where the list belongs',
      declaration: { provider: payments, endpoints: getPayment },
      line: {
        at: ['dependencies', 'payments-service', 'endpoints'],
        rule: 'not-a-list',
        message: 'endpoints is a list',
      },
    },
    {
      what: 'a provider left undefined',
      declaration: { provider: undefined, endpoints: [getPayment] },
      line: {
        at: ['dependencies', 0],
        rule: 'dependency-provider',
        message: "A Dependency's provider is the contract a Contract Package exports",
      },
    },
    {
      what: 'a provider without its exported Snapshot',
      declaration: { provider: { ...payments, exportedSnapshot: undefined } },
      line: {
        at: ['dependencies', 'payments-service'],
        rule: 'dependency-provider',
        message: "A Dependency's provider is the contract a Contract Package exports",
      },
    },
    {
      what: 'a provider whose name is no string',
      declaration: { provider: { ...payments, name: 5 }, endpoints: [getPayment] },
      line: {
        at: ['dependencies', 0],
        rule: 'dependency-provider',
        message: "A Dependency's provider is the contract a Contract Package exports",
      },
    },
    {
      what: 'a provider whose version is no string',
      declaration: { provider: { ...payments, version: 5 }, endpoints: [getPayment] },
      line: {
        at: ['dependencies', 'payments-service'],
        rule: 'dependency-provider',
        message: "A Dependency's provider is the contract a Contract Package exports",
      },
    },
  ])('$what fails with one line', ({ declaration, line }) => {
    const dependency = dependencyAsWritten(declaration);
    const contract = defineContract({ name: 'orders-service', dependencies: [dependency] });

    expect(validateInPackage(contract, noOrigin)).toEqual(failed(line.at, line.rule, line.message));
  });
});

describe('validateContract: Dependencies whose providers have no name', () => {
  test('two of them fail once each, by position, and never as one Provider listed twice', () => {
    const first = dependencyAsWritten({ provider: undefined, endpoints: [getPayment] });
    const second = dependencyAsWritten({ provider: { ...payments, name: 5 } });
    const contract = defineContract({ name: 'orders-service', dependencies: [first, second] });

    const message = "A Dependency's provider is the contract a Contract Package exports";
    expect(validateInPackage(contract, noOrigin)).toEqual({
      kind: 'invalid',
      failures: [
        { kind: 'declaration', at: ['dependencies', 0], rule: 'dependency-provider', message },
        { kind: 'declaration', at: ['dependencies', 1], rule: 'dependency-provider', message },
      ],
    });
  });
});

describe('validateContract: an Application’s Dependencies', () => {
  test('an Application depending on Public Endpoints validates', () => {
    const paymentsDependency = defineDependency({ provider: payments, endpoints: [getPayment] });
    const application = defineApplication({
      name: 'web-admin',
      dependencies: [paymentsDependency],
    });

    expect(validateInPackage(application, noOrigin).kind).toBe('valid');
  });

  test('an Application depending on an Internal Endpoint fails', () => {
    const paymentsDependency = dependencyAsWritten({
      provider: payments,
      endpoints: [refundPayment],
    });
    const dependencies = [paymentsDependency] as unknown as readonly [typeof publicDependency];
    const application = defineApplication({ name: 'web-admin', dependencies });

    expect(validateInPackage(application, noOrigin)).toEqual(
      failed(
        ['dependencies', 'payments-service', 'endpoints', 0],
        'application-dependency',
        'An Application depends on Public Endpoints only: refundPayment is internal',
      ),
    );
  });

  test('an Application depending on an Internal Endpoint its Provider does not export fails as an Application’s Dependency', () => {
    const provider = { ...payments, endpoints: { getPayment } };
    const paymentsDependency = dependencyAsWritten({ provider, endpoints: [refundPayment] });
    const dependencies = [paymentsDependency] as unknown as readonly [typeof publicDependency];
    const application = defineApplication({ name: 'web-admin', dependencies });

    expect(validateInPackage(application, noOrigin)).toEqual(
      failed(
        ['dependencies', 'payments-service', 'endpoints', 0],
        'application-dependency',
        'An Application depends on Public Endpoints only: refundPayment is internal',
      ),
    );
  });

  test('an Application depending on a Private Endpoint fails as a Private selection, not as an Application’s', () => {
    const healthCheck = defineEndpoint({
      name: 'healthCheck',
      method: 'GET',
      path: '/health',
      visibility: 'private',
      description: 'Whether the Service is up',
      success: { status: 204 },
    });
    const provider = { ...payments, endpoints: { healthCheck } };
    const paymentsDependency = dependencyAsWritten({ provider, endpoints: [healthCheck] });
    const dependencies = [paymentsDependency] as unknown as readonly [typeof publicDependency];
    const application = defineApplication({ name: 'web-admin', dependencies });

    expect(validateInPackage(application, noOrigin)).toEqual(
      failed(
        ['dependencies', 'payments-service', 'endpoints', 0],
        'dependency-selection',
        'A Dependency selects Elements its Provider exports: healthCheck is private',
      ),
    );
  });

  test('an Application’s Dependency that selects no Endpoint fails as unused', () => {
    const paymentsDependency = defineDependency({ provider: payments, endpoints: [] });
    const application = defineApplication({
      name: 'web-admin',
      dependencies: [paymentsDependency],
    });

    expect(validateInPackage(application, noOrigin)).toEqual(
      failed(
        ['dependencies', 'payments-service'],
        'unused-dependency',
        "A Dependency is used: payments-service gives no Endpoint and no Subscription's Event",
      ),
    );
  });
});

const publicDependency = defineDependency({ provider: payments, endpoints: [getPayment] });
