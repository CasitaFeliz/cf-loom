import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { summarized } from '../../test/failures.ts';
import { aProvider } from '../../test/providers.ts';
import {
  anInstalledContract,
  anUnidentifiedContract,
  aRootPackage,
} from '../../test/root-package.ts';
import {
  defineApplication,
  defineDependency,
  defineEndpoint,
  defineGroup,
  defineService,
  defineSubscription,
  providedEndpoint,
  providedEvent,
} from '../index.ts';
import { type Root, snapshotOf, validateRoot } from '../internal/index.ts';

/** Validates a Root as the package it names: its package.json named as the Root is. */
function validateInPackage(root: Root) {
  return summarized(validateRoot(root, aRootPackage(root)));
}

const getPayment = providedEndpoint(
  aProvider('payments-service'),
  {
    name: 'getPayment',
    method: 'GET',
    path: '/payments/:paymentId',
    visibility: 'public',
    description: 'One payment by id',
    input: { params: z.object({ paymentId: z.uuid() }) },
    success: { status: 200, body: z.object({ amount: z.int() }) },
  },
  undefined,
);

const refundPayment = providedEndpoint(
  aProvider('payments-service'),
  {
    name: 'refundPayment',
    method: 'POST',
    path: '/payments/:paymentId/refund',
    visibility: 'internal',
    description: 'Refunds a payment',
    input: { params: z.object({ paymentId: z.uuid() }) },
    success: { status: 204 },
  },
  undefined,
);

const healthCheck = providedEndpoint(
  aProvider('payments-service'),
  {
    name: 'healthCheck',
    method: 'GET',
    path: '/health',
    visibility: 'private',
    description: 'Whether the Service is up',
    success: { status: 204 },
  },
  undefined,
);

const getRefund = providedEndpoint(
  aProvider('refunds-service'),
  {
    name: 'getRefund',
    method: 'GET',
    path: '/refunds/:refundId',
    visibility: 'public',
    description: 'One refund by id',
    input: { params: z.object({ refundId: z.uuid() }) },
    success: { status: 200, body: z.object({ amount: z.int() }) },
  },
  undefined,
);

const listPayments = providedEndpoint(
  aProvider('payments-service'),
  {
    name: 'listPayments',
    method: 'GET',
    path: '/payments',
    visibility: 'public',
    description: 'Every payment',
    success: { status: 200, body: z.object({ count: z.int() }) },
  },
  undefined,
);

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

/** What the payments-service's Contract Package exports, by name. */
const payments = { getPayment, refundPayment, paymentSettledV1 };

/** A Dependency the types refuse, as a cast lets an author write it. */
function dependencyAsWritten(declaration: object) {
  return defineDependency(declaration as unknown as { readonly endpoints: [typeof getPayment] });
}

const notifyOnSettled = defineSubscription({
  name: 'notifyOnSettled',
  description: 'Notifies the customer of each payment settled',
  event: paymentSettledV1,
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
    const paymentsDependency = defineDependency({ endpoints: [getPayment, refundPayment] });
    const contract = defineService({
      name: 'orders-service',
      dependencies: [paymentsDependency],
    });

    expect(validateInPackage(contract).kind).toBe('valid');
  });

  test('two Dependencies on one Provider validate', () => {
    const first = defineDependency({ endpoints: [getPayment] });
    const second = defineDependency({ endpoints: [refundPayment, getPayment] });
    const contract = defineService({ name: 'orders-service', dependencies: [first, second] });

    expect(validateInPackage(contract).kind).toBe('valid');
  });

  test('a Dependency of two Providers’ Endpoints, written through a cast, fails dependency-selection at the Dependency, naming both', () => {
    const mixed = dependencyAsWritten({ endpoints: [getRefund, getPayment, refundPayment] });
    const contract = defineService({ name: 'orders-service', dependencies: [mixed] });

    expect(validateInPackage(contract)).toEqual(
      failed(
        '(root) dependencies[0]',
        'dependency-selection',
        "A Dependency lists one Provider's Endpoints: payments-service, refunds-service",
      ),
    );
  });

  test.each([
    { what: 'empty', declaration: { endpoints: [] } },
    { what: 'missing', declaration: {} },
  ])('a Dependency whose endpoints are $what fails dependency-selection', ({ declaration }) => {
    const contract = defineService({
      name: 'orders-service',
      dependencies: [dependencyAsWritten(declaration)],
    });

    expect(validateInPackage(contract)).toEqual(
      failed(
        '(root) dependencies[0]',
        'dependency-selection',
        'A Dependency lists at least one Endpoint',
      ),
    );
  });

  test('a Contract’s own Endpoint in a Dependency fails, as no Provider’s', () => {
    const paymentsDependency = dependencyAsWritten({ endpoints: [getReceipt] });
    const contract = defineService({ name: 'orders-service', dependencies: [paymentsDependency] });

    expect(validateInPackage(contract)).toEqual(
      failed(
        '(root) dependencies[0].endpoints[0]',
        'dependency-selection',
        "A Dependency lists Endpoints a Provider's Contract Package exports: getReceipt is no Provider's",
      ),
    );
  });

  test('a Contract’s own Endpoint beside a Provider’s fails only at its place, never as a second Provider', () => {
    const paymentsDependency = dependencyAsWritten({ endpoints: [getPayment, getReceipt] });
    const contract = defineService({ name: 'orders-service', dependencies: [paymentsDependency] });

    expect(validateInPackage(contract)).toEqual(
      failed(
        '(root) dependencies[0].endpoints[1]',
        'dependency-selection',
        "A Dependency lists Endpoints a Provider's Contract Package exports: getReceipt is no Provider's",
      ),
    );
  });

  test('a Private Endpoint fails at its place in the Dependency, naming its Provider', () => {
    const paymentsDependency = dependencyAsWritten({ endpoints: [getPayment, healthCheck] });
    const contract = defineService({ name: 'orders-service', dependencies: [paymentsDependency] });

    expect(validateInPackage(contract)).toEqual(
      failed(
        '(root) dependencies[0].endpoints[1]',
        'dependency-selection',
        "A Dependency lists Endpoints a Provider's Contract Package exports: payments-service's healthCheck is private",
      ),
    );
  });

  test('an Endpoint listed twice in one Dependency fails at its second listing, naming its Provider', () => {
    const paymentsDependency = dependencyAsWritten({
      endpoints: [getPayment, refundPayment, getPayment],
    });
    const contract = defineService({ name: 'orders-service', dependencies: [paymentsDependency] });

    expect(validateInPackage(contract)).toEqual(
      failed(
        '(root) dependencies[0].endpoints[2]',
        'dependency-selection',
        "A Dependency lists each Endpoint once: payments-service's getPayment is listed twice",
      ),
    );
  });

  test('a Dependency on something that is not an Endpoint fails, by its position', () => {
    const paymentsDependency = dependencyAsWritten({
      endpoints: [getPayment, { name: 'refundPayment' }],
    });
    const contract = defineService({ name: 'orders-service', dependencies: [paymentsDependency] });

    expect(validateInPackage(contract)).toEqual(
      failed('(root) dependencies[0].endpoints[1]', 'not-a-declaration', 'is not an Endpoint'),
    );
  });

  test.each([
    { field: 'events', value: [paymentSettledV1] },
    { field: 'provider', value: payments },
  ])('a Dependency holding $field fails: it lists Endpoints only', ({ field, value }) => {
    const paymentsDependency = dependencyAsWritten({ endpoints: [getPayment], [field]: value });
    const contract = defineService({ name: 'orders-service', dependencies: [paymentsDependency] });

    expect(validateInPackage(contract)).toEqual(
      failed(
        `(root) dependencies[0].${field}`,
        'undeclared-field',
        `${field} is not a declared field`,
      ),
    );
  });

  test('a Subscription to a Provider’s Event needs no Dependency, and its event names that Provider', () => {
    const contract = defineService({ name: 'orders-service', groups: [messages] });

    const validated = validateRoot(contract, aRootPackage(contract));

    expect(validated.kind).toBe('valid');
    if (validated.kind === 'valid') {
      expect(snapshotOf(validated)).toMatchObject({
        subscriptions: { notifyOnSettled: { event: 'payments-service:PaymentSettled@1' } },
      });
    }
  });
});

describe('validateRoot: a Dependency written as the types refuse', () => {
  test.each([
    {
      what: 'an Endpoint written undefined',
      declaration: { endpoints: [undefined] },
      line: {
        location: '(root) dependencies[0].endpoints[0]',
        rule: 'not-a-declaration',
        message: 'is not an Endpoint',
      },
    },
    {
      what: 'endpoints written null',
      declaration: { endpoints: null },
      line: {
        location: '(root) dependencies[0].endpoints',
        rule: 'not-a-list',
        message: 'endpoints is a list',
      },
    },
    {
      what: 'a hole where an Endpoint belongs',
      // biome-ignore lint/suspicious/noSparseArray: the hole is what the test writes
      declaration: { endpoints: [, getPayment] },
      line: {
        location: '(root) dependencies[0].endpoints[0]',
        rule: 'not-a-declaration',
        message: 'is not an Endpoint',
      },
    },
    {
      what: 'endpoints written as a map by name',
      declaration: { endpoints: { whatever: getPayment } },
      line: {
        location: '(root) dependencies[0].endpoints',
        rule: 'not-a-list',
        message: 'endpoints is a list',
      },
    },
    {
      what: 'an Endpoint written where the list belongs',
      declaration: { endpoints: getPayment },
      line: {
        location: '(root) dependencies[0].endpoints',
        rule: 'not-a-list',
        message: 'endpoints is a list',
      },
    },
  ])('$what fails with one line', ({ declaration, line }) => {
    const dependency = dependencyAsWritten(declaration);
    const contract = defineService({ name: 'orders-service', dependencies: [dependency] });

    expect(validateInPackage(contract)).toEqual(failed(line.location, line.rule, line.message));
  });
});

describe('validateRoot: an Application’s Dependencies', () => {
  test('an Application depending on Public Endpoints validates', () => {
    const paymentsDependency = defineDependency({ endpoints: [getPayment] });
    const application = defineApplication({
      name: 'web-admin',
      dependencies: [paymentsDependency],
    });

    expect(validateInPackage(application).kind).toBe('valid');
  });

  test('an Application depending on an Internal Endpoint fails at its place, naming its Provider', () => {
    const paymentsDependency = dependencyAsWritten({ endpoints: [refundPayment] });
    const application = defineApplication({
      name: 'web-admin',
      dependencies: [paymentsDependency],
    });

    expect(validateInPackage(application)).toEqual(
      failed(
        '(root) dependencies[0].endpoints[0]',
        'application-dependency',
        "An Application depends on Public Endpoints only: payments-service's refundPayment is internal",
      ),
    );
  });

  test('an Application depending on a Private Endpoint fails as a Private selection, not as an Application’s', () => {
    const paymentsDependency = dependencyAsWritten({ endpoints: [healthCheck] });
    const application = defineApplication({
      name: 'web-admin',
      dependencies: [paymentsDependency],
    });

    expect(validateInPackage(application)).toEqual(
      failed(
        '(root) dependencies[0].endpoints[0]',
        'dependency-selection',
        "A Dependency lists Endpoints a Provider's Contract Package exports: payments-service's healthCheck is private",
      ),
    );
  });

  test('an Application’s Dependency that lists no Endpoint fails', () => {
    const application = defineApplication({
      name: 'web-admin',
      dependencies: [dependencyAsWritten({ endpoints: [] })],
    });

    expect(validateInPackage(application)).toEqual(
      failed(
        '(root) dependencies[0]',
        'dependency-selection',
        'A Dependency lists at least one Endpoint',
      ),
    );
  });
});

describe('validateRoot: the installed Contract Package of a Provider', () => {
  const ordersWithPayments = defineService({
    name: 'orders-service',
    dependencies: [defineDependency({ endpoints: [getPayment] })],
  });

  function validatedAmong(contractPackages: ReturnType<typeof aRootPackage>['contractPackages']) {
    return summarized(
      validateRoot(ordersWithPayments, aRootPackage(ordersWithPayments, { contractPackages })),
    );
  }

  test('a Dependency whose Endpoint no installed package exports fails dependency-package, naming the Provider', () => {
    const validated = validatedAmong([]);

    expect(validated).toEqual(
      failed(
        '(root) dependencies[0]',
        'dependency-package',
        "A Provider's Elements come from an installed Contract Package: no installed package exports payments-service's Elements",
      ),
    );
  });

  test('a package exporting other Elements of the Provider’s name does not count', () => {
    const other = anInstalledContract('payments-service', [refundPayment]);

    const validated = validatedAmong([other]);

    expect(validated).toMatchObject({
      kind: 'invalid',
      failures: [{ location: '(root) dependencies[0]', rule: 'dependency-package' }],
    });
  });

  test('a Provider exported by a package whose package.json has no version fails, naming it', () => {
    const unversioned = anUnidentifiedContract(
      { kind: 'unversioned', packageName: '@org/contract-payments-service' },
      payments,
    );

    const validated = validatedAmong([unversioned]);

    expect(validated).toEqual(
      failed(
        '(root) dependencies[0]',
        'dependency-package',
        "A Provider's Contract Package has a name and a version: payments-service's comes from @org/contract-payments-service, which has no version in its package.json",
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
        '(root) dependencies[0]',
        'dependency-package',
        "A Provider's Contract Package has a name and a version: payments-service's comes from node_modules/contract-payments/package.json, which has no name",
      ),
    );
  });

  test('a Provider whose Elements two packages export is one line at each Dependency and each Subscription holding them, naming both packages', () => {
    const contract = defineService({
      name: 'orders-service',
      groups: [messages],
      dependencies: [
        defineDependency({ endpoints: [getPayment] }),
        defineDependency({ endpoints: [refundPayment] }),
      ],
    });
    const first = anInstalledContract('payments-service', payments);
    const second = anInstalledContract('payments-service', payments, {
      packageName: '@org/payments-mirror',
    });

    const validated = summarized(
      validateRoot(contract, aRootPackage(contract, { contractPackages: [first, second] })),
    );

    const message =
      "A Provider's Elements come from one Contract Package: payments-service's Elements are exported by both @org/contract-payments-service and @org/payments-mirror, and neither imports them from the other";
    expect(validated).toEqual({
      kind: 'invalid',
      failures: [
        {
          kind: 'declaration',
          location: '(root) dependencies[0]',
          rule: 'dependency-package',
          message,
        },
        {
          kind: 'declaration',
          location: '(root) dependencies[1]',
          rule: 'dependency-package',
          message,
        },
        {
          kind: 'declaration',
          location: 'subscriptions.notifyOnSettled',
          rule: 'dependency-package',
          message,
        },
      ],
    });
  });

  test('a Dependency listing two of a Provider’s Endpoints gets one dependency-package line', () => {
    const contract = defineService({
      name: 'orders-service',
      dependencies: [defineDependency({ endpoints: [getPayment, refundPayment] })],
    });

    const validated = summarized(
      validateRoot(contract, aRootPackage(contract, { contractPackages: [] })),
    );

    expect(validated).toEqual(
      failed(
        '(root) dependencies[0]',
        'dependency-package',
        "A Provider's Elements come from an installed Contract Package: no installed package exports payments-service's Elements",
      ),
    );
  });

  test('a package that re-exports the Elements of another is passed over for the one it imports them from', () => {
    const original = anInstalledContract('payments-service', payments);
    const wrapper = anInstalledContract('payments-service', payments, {
      packageName: '@org/payments-wrapper',
      reaches: [original],
    });

    const validated = validatedAmong([wrapper, original]);

    expect(validated.kind).toBe('valid');
  });

  test('an Application’s Dependency needs its Provider installed too', () => {
    const application = defineApplication({
      name: 'web-admin',
      dependencies: [defineDependency({ endpoints: [getPayment] })],
    });

    const validated = summarized(
      validateRoot(application, aRootPackage(application, { contractPackages: [] })),
    );

    expect(validated).toMatchObject({
      kind: 'invalid',
      failures: [{ location: '(root) dependencies[0]', rule: 'dependency-package' }],
    });
  });
});

describe('snapshotOf: the Providers a Contract uses', () => {
  function snapshotAmong(root: Root, contractPackages = aRootPackage(root).contractPackages) {
    const validated = validateRoot(root, aRootPackage(root, { contractPackages }));
    if (validated.kind !== 'valid') {
      throw new Error(`The fixture is invalid: ${JSON.stringify(validated.failures)}`);
    }
    const snapshot = snapshotOf(validated);
    if (snapshot.kind === 'definitions') {
      throw new Error('The fixture is no Contract');
    }
    return snapshot;
  }

  test('against is the version of the installed package that exports the listed Endpoint', () => {
    const contract = defineService({
      name: 'orders-service',
      dependencies: [defineDependency({ endpoints: [getPayment] })],
    });
    const installed = anInstalledContract('payments-service', payments, { version: '2.3.0' });
    const lookalike = anInstalledContract('payments-service', [refundPayment], {
      packageName: '@org/payments-lookalike',
      version: '9.9.9',
    });

    const snapshot = snapshotAmong(contract, [lookalike, installed]);

    expect(snapshot.dependencies).toEqual({
      'payments-service': {
        against: '2.3.0',
        endpoints: [{ id: 'GET /payments/{}', name: 'getPayment' }],
      },
    });
  });

  test('an Endpoint listed in two Dependencies is recorded once', () => {
    const contract = defineService({
      name: 'orders-service',
      dependencies: [
        defineDependency({ endpoints: [getPayment] }),
        defineDependency({ endpoints: [refundPayment, getPayment] }),
      ],
    });

    const snapshot = snapshotAmong(contract);

    expect(snapshot.dependencies).toEqual({
      'payments-service': {
        against: '1.0.0',
        endpoints: [
          { id: 'GET /payments/{}', name: 'getPayment' },
          { id: 'POST /payments/{}/refund', name: 'refundPayment' },
        ],
      },
    });
  });

  test('a Subscription-only Provider is recorded against the installed package that exports its Event, with no Endpoint', () => {
    const contract = defineService({ name: 'orders-service', groups: [messages] });
    const installed = anInstalledContract('payments-service', payments, { version: '4.0.1' });

    const snapshot = snapshotAmong(contract, [installed]);

    expect(snapshot.dependencies).toEqual({
      'payments-service': { against: '4.0.1', endpoints: [] },
    });
  });

  test.each(splitsOf([getPayment, refundPayment, listPayments]))(
    'two Dependencies on one Provider pass, and the Snapshot records its Endpoints once, sorted, however they are split: %#',
    (...split) => {
      const contract = defineService({
        name: 'orders-service',
        dependencies: split.map((endpoints) => dependencyAsWritten({ endpoints })),
      });

      const snapshot = snapshotAmong(contract);

      expect(JSON.stringify(snapshot.dependencies)).toBe(
        JSON.stringify({
          'payments-service': {
            against: '1.0.0',
            endpoints: [
              { id: 'GET /payments', name: 'listPayments' },
              { id: 'GET /payments/{}', name: 'getPayment' },
              { id: 'POST /payments/{}/refund', name: 'refundPayment' },
            ],
          },
        }),
      );
    },
  );
});

/** Every split of some Endpoints into one or more non-empty Dependencies, in every order. */
function splitsOf<Item>(items: readonly Item[]): readonly (readonly Item[][])[] {
  const splits: Item[][][] = [];
  for (const ordered of permutationsOf(items)) {
    for (let cuts = 0; cuts < 2 ** (ordered.length - 1); cuts += 1) {
      splits.push(cutAt(ordered, cuts));
    }
  }
  return splits;
}

function permutationsOf<Item>(items: readonly Item[]): readonly (readonly Item[])[] {
  if (items.length <= 1) {
    return [items];
  }
  return items.flatMap((item, index) =>
    permutationsOf([...items.slice(0, index), ...items.slice(index + 1)]).map((rest) => [
      item,
      ...rest,
    ]),
  );
}

/** A list cut into consecutive parts after each position whose bit is set in `cuts`. */
function cutAt<Item>(ordered: readonly Item[], cuts: number): Item[][] {
  const parts: Item[][] = [[]];
  ordered.forEach((item, index) => {
    parts.at(-1)?.push(item);
    if (index < ordered.length - 1 && (cuts >> index) & 1) {
      parts.push([]);
    }
  });
  return parts;
}
