import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { summarized } from '../../test/failures.ts';
import {
  anInstalledContract,
  anUnidentifiedContract,
  aRootPackage,
} from '../../test/root-package.ts';
import {
  type ContractPackage,
  defineApplication,
  defineDependency,
  defineEndpoint,
  defineEvent,
  defineGroup,
  defineService,
  defineSubscription,
  providedEndpoint,
  providedEvent,
} from '../index.ts';
import { type Root, validateRoot } from '../internal/index.ts';

/** Validates a Root as the package it names: its package.json named as the Root is. */
function validateInPackage(root: Root) {
  return summarized(validateRoot(root, aRootPackage(root)));
}

const getPayment = providedEndpoint('payments-service', {
  name: 'getPayment',
  method: 'GET',
  path: '/payments/:paymentId',
  visibility: 'public',
  description: 'One payment by id',
  input: { params: z.object({ paymentId: z.uuid() }) },
  success: { status: 200, body: z.object({ amount: z.int() }) },
});

const refundPayment = providedEndpoint('payments-service', {
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

const paymentSettledV1 = providedEvent('payments-service', {
  name: 'PaymentSettled',
  version: 1,
  visibility: 'internal',
  description: 'A payment was settled',
  body: z.object({ paymentId: z.uuid() }),
});

const payments = {
  name: 'payments-service',
  endpoints: { getPayment, refundPayment },
  events: { paymentSettledV1 },
  standardRejections: {
    invalidInput: {
      code: 'INVALID_INPUT',
      status: 400,
      message: 'Invalid input',
      body: z.object({ issues: z.array(z.unknown()) }),
    },
    notFound: { code: 'NOT_FOUND', status: 404, message: 'Not found' },
    notImplemented: { code: 'NOT_IMPLEMENTED', status: 501, message: 'Not implemented' },
  },
  exportedSnapshot: {
    format: 1,
    defs: {},
    endpoints: {},
    events: {},
    guards: {},
    codes: {},
    shadowing: {},
  },
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

function failed(location: string, rule: string, message: string) {
  return { kind: 'invalid', failures: [{ kind: 'declaration', location, rule, message }] };
}

describe('validateRoot: a Service’s Dependencies', () => {
  test('a Dependency on Public and Internal Endpoints validates', () => {
    const paymentsDependency = defineDependency({
      provider: payments,
      endpoints: [getPayment, refundPayment],
    });
    const contract = defineService({
      name: 'orders-service',
      dependencies: [paymentsDependency],
    });

    expect(validateInPackage(contract).kind).toBe('valid');
  });

  test('a Dependency only a Subscription uses, through its Provider’s Event, validates', () => {
    const paymentsDependency = defineDependency({ provider: payments });
    const contract = defineService({
      name: 'orders-service',
      groups: [messages],
      dependencies: [paymentsDependency],
    });

    expect(validateInPackage(contract).kind).toBe('valid');
  });

  test('a Dependency that selects no Endpoint and whose Event no Subscription receives fails', () => {
    const paymentsDependency = defineDependency({ provider: payments, endpoints: [] });
    const contract = defineService({ name: 'orders-service', dependencies: [paymentsDependency] });

    expect(validateInPackage(contract)).toEqual(
      failed(
        'dependencies.payments-service',
        'unused-dependency',
        "A Dependency is used: payments-service gives no Endpoint and no Subscription's Event",
      ),
    );
  });

  test('a second Dependency exporting a Subscription’s Event gives it nothing, so it is unused', () => {
    const mirror = { ...payments, name: 'mirror-service' };
    const contract = defineService({
      name: 'orders-service',
      groups: [messages],
      dependencies: [
        defineDependency({ provider: payments }),
        dependencyAsWritten({ provider: mirror }),
      ],
    });
    const installed = anInstalledContract(payments);
    const mirrored = anInstalledContract(mirror, { reaches: [installed] });
    const contractPackages = [installed, mirrored];

    expect(
      summarized(validateRoot(contract, aRootPackage(contract, { contractPackages }))),
    ).toEqual(
      failed(
        'dependencies.mirror-service',
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
    const contract = defineService({
      name: 'orders-service',
      groups: [orders],
      dependencies: [dependencyAsWritten({ provider: { ...payments, name: 'orders-service' } })],
    });

    expect(validateInPackage(contract)).toEqual(
      failed(
        'dependencies.orders-service',
        'unused-dependency',
        "A Dependency is used: orders-service gives no Endpoint and no Subscription's Event",
      ),
    );
  });

  test('a Dependency on an Endpoint the Provider does not export fails', () => {
    const paymentsDependency = dependencyAsWritten({ provider: payments, endpoints: [getReceipt] });
    const contract = defineService({ name: 'orders-service', dependencies: [paymentsDependency] });

    expect(validateInPackage(contract)).toEqual(
      failed(
        'dependencies.payments-service endpoints[0]',
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
    const contract = defineService({ name: 'orders-service', dependencies: [paymentsDependency] });

    expect(validateInPackage(contract)).toEqual(
      failed(
        'dependencies.payments-service endpoints[0]',
        'dependency-selection',
        'A Dependency selects Elements its Provider exports: healthCheck is private',
      ),
    );
  });

  test('a Dependency on something that is not an Endpoint fails, by its position', () => {
    const endpoints = [getPayment, { name: 'refundPayment' }];
    const paymentsDependency = dependencyAsWritten({ provider: payments, endpoints });
    const contract = defineService({ name: 'orders-service', dependencies: [paymentsDependency] });

    expect(validateInPackage(contract)).toEqual(
      failed(
        'dependencies.payments-service endpoints[1]',
        'not-a-declaration',
        'is not an Endpoint',
      ),
    );
  });

  test('a Dependency holding events fails: a Subscription takes its Event from the Contract Package', () => {
    const paymentsDependency = dependencyAsWritten({
      provider: payments,
      endpoints: [getPayment],
      events: [paymentSettledV1],
    });
    const contract = defineService({ name: 'orders-service', dependencies: [paymentsDependency] });

    expect(validateInPackage(contract)).toEqual(
      failed(
        'dependencies.payments-service events',
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
    const contract = defineService({ name: 'orders-service', dependencies: [paymentsDependency] });

    expect(validateInPackage(contract)).toEqual(
      failed(
        'dependencies.payments-service endpoints[2]',
        'dependency-selection',
        'A Dependency selects Elements its Provider exports: getPayment is listed twice',
      ),
    );
  });

  test('two Dependencies on one Provider fail', () => {
    const first = defineDependency({ provider: payments, endpoints: [getPayment] });
    const second = defineDependency({ provider: payments, endpoints: [refundPayment] });
    const contract = defineService({ name: 'orders-service', dependencies: [first, second] });

    expect(validateInPackage(contract)).toEqual(
      failed(
        'dependencies.payments-service',
        'duplicate-dependency',
        'A Contract lists one Dependency per Provider: "payments-service"',
      ),
    );
  });
});

describe('validateRoot: a Dependency written as the types refuse', () => {
  test.each([
    {
      what: 'an Endpoint written undefined',
      declaration: { provider: payments, endpoints: [undefined] },
      line: {
        location: 'dependencies.payments-service endpoints[0]',
        rule: 'not-a-declaration',
        message: 'is not an Endpoint',
      },
    },
    {
      what: 'endpoints written null',
      declaration: { provider: payments, endpoints: null },
      line: {
        location: 'dependencies.payments-service endpoints',
        rule: 'not-a-list',
        message: 'endpoints is a list',
      },
    },
    {
      what: 'a hole where an Endpoint belongs',
      // biome-ignore lint/suspicious/noSparseArray: the hole is what the test writes
      declaration: { provider: payments, endpoints: [, getPayment] },
      line: {
        location: 'dependencies.payments-service endpoints[0]',
        rule: 'not-a-declaration',
        message: 'is not an Endpoint',
      },
    },
    {
      what: 'endpoints written as a map by name',
      declaration: { provider: payments, endpoints: { whatever: getPayment } },
      line: {
        location: 'dependencies.payments-service endpoints',
        rule: 'not-a-list',
        message: 'endpoints is a list',
      },
    },
    {
      what: 'endpoints written as an empty map',
      declaration: { provider: payments, endpoints: {} },
      line: {
        location: 'dependencies.payments-service endpoints',
        rule: 'not-a-list',
        message: 'endpoints is a list',
      },
    },
    {
      what: 'an Endpoint written where the list belongs',
      declaration: { provider: payments, endpoints: getPayment },
      line: {
        location: 'dependencies.payments-service endpoints',
        rule: 'not-a-list',
        message: 'endpoints is a list',
      },
    },
    {
      what: 'a provider left undefined',
      declaration: { provider: undefined, endpoints: [getPayment] },
      line: {
        location: '(root) dependencies[0]',
        rule: 'dependency-provider',
        message: "A Dependency's provider is the contract a Contract Package exports",
      },
    },
    {
      what: 'a provider without its exported Snapshot',
      declaration: { provider: { ...payments, exportedSnapshot: undefined } },
      line: {
        location: 'dependencies.payments-service',
        rule: 'dependency-provider',
        message: "A Dependency's provider is the contract a Contract Package exports",
      },
    },
    {
      what: 'a provider whose name is no string',
      declaration: { provider: { ...payments, name: 5 }, endpoints: [getPayment] },
      line: {
        location: '(root) dependencies[0]',
        rule: 'dependency-provider',
        message: "A Dependency's provider is the contract a Contract Package exports",
      },
    },
  ])('$what fails with one line', ({ declaration, line }) => {
    const dependency = dependencyAsWritten(declaration);
    const contract = defineService({ name: 'orders-service', dependencies: [dependency] });

    expect(validateInPackage(contract)).toEqual(failed(line.location, line.rule, line.message));
  });
});

describe('validateRoot: Dependencies whose providers have no name', () => {
  test('two of them fail once each, by position, and never as one Provider listed twice', () => {
    const first = dependencyAsWritten({ provider: undefined, endpoints: [getPayment] });
    const second = dependencyAsWritten({ provider: { ...payments, name: 5 } });
    const contract = defineService({ name: 'orders-service', dependencies: [first, second] });

    const message = "A Dependency's provider is the contract a Contract Package exports";
    expect(validateInPackage(contract)).toEqual({
      kind: 'invalid',
      failures: [
        {
          kind: 'declaration',
          location: '(root) dependencies[0]',
          rule: 'dependency-provider',
          message,
        },
        {
          kind: 'declaration',
          location: '(root) dependencies[1]',
          rule: 'dependency-provider',
          message,
        },
      ],
    });
  });
});

describe('validateRoot: an Application’s Dependencies', () => {
  test('an Application depending on Public Endpoints validates', () => {
    const paymentsDependency = defineDependency({ provider: payments, endpoints: [getPayment] });
    const application = defineApplication({
      name: 'web-admin',
      dependencies: [paymentsDependency],
    });

    expect(validateInPackage(application).kind).toBe('valid');
  });

  test('an Application depending on an Internal Endpoint fails', () => {
    const paymentsDependency = dependencyAsWritten({
      provider: payments,
      endpoints: [refundPayment],
    });
    const dependencies = [paymentsDependency] as unknown as readonly [typeof publicDependency];
    const application = defineApplication({ name: 'web-admin', dependencies });

    expect(validateInPackage(application)).toEqual(
      failed(
        'dependencies.payments-service endpoints[0]',
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

    expect(validateInPackage(application)).toEqual(
      failed(
        'dependencies.payments-service endpoints[0]',
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

    expect(validateInPackage(application)).toEqual(
      failed(
        'dependencies.payments-service endpoints[0]',
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

    expect(validateInPackage(application)).toEqual(
      failed(
        'dependencies.payments-service',
        'unused-dependency',
        "A Dependency is used: payments-service gives no Endpoint and no Subscription's Event",
      ),
    );
  });
});

const publicDependency = defineDependency({ provider: payments, endpoints: [getPayment] });

describe('validateRoot: the installed Contract Package of a Dependency', () => {
  const ordersWithPayments = defineService({
    name: 'orders-service',
    dependencies: [defineDependency({ provider: payments, endpoints: [getPayment] })],
  });
  const contractName = `A Dependency's provider is an installed Contract Package's contract`;

  function validatedAmong(contractPackages: ReturnType<typeof aRootPackage>['contractPackages']) {
    return summarized(
      validateRoot(ordersWithPayments, aRootPackage(ordersWithPayments, { contractPackages })),
    );
  }

  test('a Dependency whose Provider no installed package exports fails, naming the Provider', () => {
    const validated = validatedAmong([]);

    expect(validated).toEqual(
      failed(
        'dependencies.payments-service',
        'dependency-package',
        `${contractName}: no installed package exports payments-service's Elements`,
      ),
    );
  });

  test('a Dependency whose Provider another package’s contract exports does not count that package', () => {
    const other = { ...payments, name: 'other-service', endpoints: {}, events: {} };

    const validated = validatedAmong([anInstalledContract(other)]);

    expect(validated).toEqual(
      failed(
        'dependencies.payments-service',
        'dependency-package',
        `${contractName}: no installed package exports payments-service's Elements`,
      ),
    );
  });

  test('a Provider exported by a package whose package.json has no version fails, naming it', () => {
    const unversioned = anUnidentifiedContract(
      { kind: 'unversioned', packageName: '@org/contract-payments-service' },
      payments,
    );

    const validated = validatedAmong([unversioned]);

    expect(validated).toEqual(
      failed(
        'dependencies.payments-service',
        'dependency-package',
        "A Dependency's Contract Package has a name and a version: @org/contract-payments-service has no version in its package.json",
      ),
    );
  });

  test('a Provider exported by a package whose package.json has no name fails, naming its path', () => {
    const unnamed = anUnidentifiedContract(
      { kind: 'unnamed', manifest: 'node_modules/contract-payments/package.json' },
      payments,
    );

    const validated = validatedAmong([unnamed]);

    expect(validated).toEqual(
      failed(
        'dependencies.payments-service',
        'dependency-package',
        "A Dependency's Contract Package has a name and a version: node_modules/contract-payments/package.json has no name",
      ),
    );
  });

  test('a Provider exported by two packages, neither importing it from the other, fails, naming both', () => {
    const first = anInstalledContract(payments, { packageName: '@org/contract-payments-service' });
    const second = anInstalledContract(payments, { packageName: '@org/payments-mirror' });

    const validated = validatedAmong([first, second]);

    expect(validated).toEqual(
      failed(
        'dependencies.payments-service',
        'dependency-package',
        "A Dependency's Contract Package is one package: payments-service's Elements are exported by both @org/contract-payments-service and @org/payments-mirror, and neither imports them from the other",
      ),
    );
  });

  test('a package that re-exports the contract of another is passed over for the one it imports it from', () => {
    const original = anInstalledContract(payments);
    const wrapper = anInstalledContract(payments, {
      packageName: '@org/payments-wrapper',
      reaches: [original],
    });

    const validated = validatedAmong([wrapper, original]);

    expect(validated.kind).toBe('valid');
  });

  test('an Application’s Dependency needs its Provider installed too', () => {
    const application = defineApplication({
      name: 'web-admin',
      dependencies: [defineDependency({ provider: payments, endpoints: [getPayment] })],
    });

    const validated = summarized(
      validateRoot(application, aRootPackage(application, { contractPackages: [] })),
    );

    expect(validated).toMatchObject({
      kind: 'invalid',
      failures: [{ location: 'dependencies.payments-service', rule: 'dependency-package' }],
    });
  });
});
