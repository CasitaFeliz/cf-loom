import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import {
  type ContractPackage,
  defineApplication,
  defineCommand,
  defineContract,
  defineDefinitions,
  defineDependencies,
  defineEndpoint,
  defineEvent,
  defineGroup,
  defineSubscription,
} from '../index.ts';

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

  test('a Contract keeps its Events, Commands and Subscriptions by identity', () => {
    const orderCreatedV1 = defineEvent({
      name: 'OrderCreated',
      version: 1,
      visibility: 'internal',
      description: 'An order was placed',
      body: z.object({ orderId: z.uuid() }),
    });
    const chargeCardV1 = defineCommand({
      name: 'ChargeCard',
      version: 1,
      description: 'Charges the order’s card',
      body: z.object({ orderId: z.uuid() }),
    });
    const notifyOnCreated = defineSubscription({
      name: 'notify-on-created',
      event: orderCreatedV1,
    });

    const contract = defineContract({
      name: 'orders-service',
      events: [orderCreatedV1],
      commands: [chargeCardV1],
      subscriptions: [notifyOnCreated],
    });

    expect(contract.events[0]).toBe(orderCreatedV1);
    expect(contract.commands[0]).toBe(chargeCardV1);
    expect(contract.subscriptions[0]).toBe(notifyOnCreated);
  });
});

describe('defineApplication', () => {
  test('an Application may depend on Public Endpoints', () => {
    const publicDeps = defineDependencies(payments, { endpoints: [getPayment] });

    const application = defineApplication({ name: 'web-admin', dependencies: [publicDeps] });

    expect(application.dependencies[0]).toBe(publicDeps);
  });

  test('an Application depending on an Internal Endpoint is a type error', () => {
    const internalDeps = defineDependencies(payments, { endpoints: [refundPayment] });

    // @ts-expect-error an Application runs outside the internal network
    const declare = () => defineApplication({ name: 'web-admin', dependencies: [internalDeps] });

    expect(declare).not.toThrow();
  });

  test('an Application depending on an Event is a type error', () => {
    const eventDeps = defineDependencies(payments, { events: [paymentSettledV1] });

    // @ts-expect-error an Application subscribes to no Event
    const declare = () => defineApplication({ name: 'web-admin', dependencies: [eventDeps] });

    expect(declare).not.toThrow();
  });

  test('an Application without dependencies is a type error', () => {
    // @ts-expect-error an Application lists its Dependencies
    const declare = () => defineApplication({ name: 'web-admin' });

    expect(declare).not.toThrow();
  });
});

describe('the roots’ fields', () => {
  test('an undeclared field on a Contract is a type error', () => {
    // @ts-expect-error a Contract lists its Endpoints through its Groups
    const declare = () => defineContract({ name: 'orders-service', endpoints: [] });

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
