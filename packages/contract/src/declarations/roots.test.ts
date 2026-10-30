import { describe, expect, expectTypeOf, test } from 'vitest';
import { z } from 'zod';
import { aProvider } from '../../test/providers.ts';
import {
  type Contract,
  defineApplication,
  defineCommand,
  defineDefinitions,
  defineDependency,
  defineEndpoint,
  defineEvent,
  defineGroup,
  defineService,
  defineSubscription,
  providedEndpoint,
  providedEvent,
} from '../index.ts';
import type { Refusal } from '../internal/index.ts';

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

const refundCardV1 = defineCommand({
  name: 'RefundCard',
  version: 1,
  description: 'Refunds the payment’s card',
  body: z.object({ paymentId: z.uuid() }),
});

const auditOnSettled = defineSubscription({
  name: 'auditOnSettled',
  description: 'Audits each payment settled',
  event: paymentSettledV1,
});

/** The payments-service's Elements as its Contract Package exports them by name. */
const payments = {
  endpoints: {
    getPayment: providedEndpoint(aProvider('payments-service'), getPayment, undefined),
    refundPayment: providedEndpoint(aProvider('payments-service'), refundPayment, undefined),
  },
  events: { paymentSettledV1: providedEvent('payments-service', paymentSettledV1) },
};

describe('defineService', () => {
  test('a Service’s Contract is what was written with the kind service, frozen', () => {
    const service = defineService({ name: 'orders-service' });

    expect(service).toEqual({ kind: 'service', name: 'orders-service' });
    expect(Object.isFrozen(service)).toBe(true);
  });

  test('definitions is a type error: what a Service’s Contract reaches says which Definitions Packages it uses', () => {
    // @ts-expect-error TS2322 definitions is not a declared field
    const contract = defineService({ name: 'orders-service', definitions: [] });

    expect(contract.kind).toBe('service');
  });

  test('a Service’s Contract keeps what its Root lists by identity', () => {
    const definitions = defineDefinitions({});
    const paymentsGroup = defineGroup({
      name: 'payments',
      description: 'Payments',
      endpoints: [getPayment],
    });
    const paymentsDependency = defineDependency({
      endpoints: [payments.endpoints.refundPayment],
    });

    const contract = defineService({
      name: 'orders-service',
      standardRejections: definitions,
      groups: [paymentsGroup],
      dependencies: [paymentsDependency],
    });

    expect(contract.groups[0]).toBe(paymentsGroup);
    expect(contract.standardRejections).toBe(definitions);
    expect(contract.dependencies[0]).toBe(paymentsDependency);
    expect(contract.kind).toBe('service');
  });

  test('a Service’s Contract keeps each Group’s Command and Subscription with its exact type', () => {
    const paymentsGroup = defineGroup({
      name: 'payments',
      description: 'Payments',
      events: [paymentSettledV1],
      commands: [refundCardV1],
      subscriptions: [auditOnSettled],
    });

    const contract = defineService({ name: 'payments-service', groups: [paymentsGroup] });

    expectTypeOf(contract.groups[0].commands[0]).toEqualTypeOf(refundCardV1);
    expectTypeOf(contract.groups[0].subscriptions[0]).toEqualTypeOf(auditOnSettled);
    expect(contract.groups[0].commands[0]).toBe(refundCardV1);
  });
});

describe('defineApplication', () => {
  test('an Application may depend on Public Endpoints', () => {
    const publicDependency = defineDependency({
      endpoints: [payments.endpoints.getPayment],
    });

    const application = defineApplication({ name: 'web-admin', dependencies: [publicDependency] });

    expect(application.dependencies[0]).toBe(publicDependency);
  });

  test('an Application depending on an Internal Endpoint is a type error', () => {
    const internalDependency = defineDependency({
      endpoints: [payments.endpoints.refundPayment],
    });

    const declare = () =>
      // @ts-expect-error TS2322 an Application runs outside the internal network
      defineApplication({ name: 'web-admin', dependencies: [internalDependency] });

    expect(declare).not.toThrow();
  });

  test('an Application depending on an Internal Endpoint is refused as generate words it', () => {
    const internalDependency = defineDependency({
      endpoints: [payments.endpoints.refundPayment],
    });
    type Written = Parameters<
      typeof defineApplication<{
        readonly name: 'web-admin';
        readonly dependencies: readonly [typeof internalDependency];
      }>
    >[0];

    expectTypeOf<Written['dependencies']>().toExtend<
      Refusal<"An Application depends on Public Endpoints only: payments-service's refundPayment is internal">
    >();
  });

  test('an Application may list no Dependencies, which means it depends on nothing', () => {
    const application = defineApplication({ name: 'web-admin' });

    expect(application).toEqual({ kind: 'application', name: 'web-admin' });
  });
});

describe('Contract', () => {
  test('a Service’s and an Application’s Contract are Contracts, a Definitions Package is not', () => {
    const service = defineService({ name: 'orders-service' });
    const application = defineApplication({ name: 'web-admin' });
    const definitions = defineDefinitions({});

    expectTypeOf(service).toExtend<Contract>();
    expectTypeOf(application).toExtend<Contract>();
    expectTypeOf(definitions).not.toExtend<Contract>();
    expect([service.kind, application.kind]).toEqual(['service', 'application']);
  });
});

describe('the Roots’ fields', () => {
  test('an undeclared field on a Service’s Contract is a type error', () => {
    // @ts-expect-error TS2322 a Service’s Contract lists its Endpoints through its Groups
    const declare = () => defineService({ name: 'orders-service', endpoints: [] });

    expect(declare).not.toThrow();
  });

  test.each([
    [
      'events',
      // @ts-expect-error TS2322 a Service’s Contract lists its Events through its Groups
      () => defineService({ name: 'payments-service', events: [paymentSettledV1] }),
    ],
    [
      'commands',
      // @ts-expect-error TS2322 a Service’s Contract lists its Commands through its Groups
      () => defineService({ name: 'payments-service', commands: [refundCardV1] }),
    ],
    [
      'subscriptions',
      // @ts-expect-error TS2322 a Service’s Contract lists its Subscriptions through its Groups
      () => defineService({ name: 'payments-service', subscriptions: [auditOnSettled] }),
    ],
  ])('a Service’s Root that lists %s is a type error', (_field, declare) => {
    expect(declare).not.toThrow();
  });

  test('an undeclared field on an Application is a type error', () => {
    const declare = () =>
      // @ts-expect-error TS2322 an Application offers no Endpoints
      defineApplication({ name: 'web-admin', dependencies: [], groups: [] });

    expect(declare).not.toThrow();
  });
});

describe('a declared Root’s containers', () => {
  test('a Service’s Contract freezes its lists', () => {
    const groups = [
      defineGroup({ name: 'payments', description: 'Payments', endpoints: [getPayment] }),
    ];

    const contract = defineService({ name: 'payments-service', groups });
    groups.pop();

    expect(contract.groups).toHaveLength(1);
    expect(Object.isFrozen(contract.groups)).toBe(true);
  });

  test('an Application freezes its list of Dependencies', () => {
    const application = defineApplication({ name: 'web-admin', dependencies: [] });

    expect(Object.isFrozen(application.dependencies)).toBe(true);
  });
});
