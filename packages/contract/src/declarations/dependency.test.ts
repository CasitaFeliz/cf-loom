import { describe, expect, expectTypeOf, test } from 'vitest';
import { z } from 'zod';
import { aProvider } from '../../test/providers.ts';
import {
  type Dependency,
  defineDependency,
  defineEndpoint,
  providedEndpoint,
  providedEvent,
} from '../index.ts';

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

const paymentSettledV1 = providedEvent('payments-service', {
  name: 'PaymentSettled',
  version: 1,
  visibility: 'internal',
  description: 'A payment was settled',
  body: z.object({ paymentId: z.uuid() }),
});

describe('defineDependency', () => {
  test('a Dependency keeps the Endpoints it lists, as listed, and its client’s names are theirs', () => {
    const paymentsDependency = defineDependency({ endpoints: [getPayment, refundPayment] });

    expect(paymentsDependency.kind).toBe('dependency');
    expect(paymentsDependency.endpoints).toEqual([getPayment, refundPayment]);
    expect(paymentsDependency.endpoints[0]).toBe(getPayment);
    expectTypeOf(paymentsDependency.endpoints).toEqualTypeOf<
      readonly [typeof getPayment, typeof refundPayment]
    >();
    expectTypeOf<(typeof paymentsDependency.endpoints)[number]['name']>().toEqualTypeOf<
      'getPayment' | 'refundPayment'
    >();
  });

  test('a Dependency is a Dependency of the Endpoints it lists', () => {
    const paymentsDependency = defineDependency({ endpoints: [getPayment] });

    expectTypeOf(paymentsDependency).toExtend<Dependency>();
    expectTypeOf<keyof typeof paymentsDependency>().toEqualTypeOf<'kind' | 'endpoints'>();
  });

  test('a Dependency of two Providers’ Endpoints is a type error naming both', () => {
    type Written = Parameters<
      typeof defineDependency<{
        readonly endpoints: readonly [typeof getPayment, typeof getRefund];
      }>
    >[0];

    expectTypeOf<
      Written['endpoints']
    >().toExtend<"A Dependency lists one Provider's Endpoints: payments-service, refunds-service">();
    // @ts-expect-error a Dependency calls one Provider
    const declare = () => defineDependency({ endpoints: [getPayment, getRefund] });
    expect(declare).not.toThrow();
  });

  test('a Dependency that lists no Endpoint is a type error', () => {
    // @ts-expect-error a Dependency lists at least one Endpoint
    const empty = () => defineDependency({ endpoints: [] });
    // @ts-expect-error nor leaves its list out
    const missing = () => defineDependency({});

    expect(empty).not.toThrow();
    expect(missing).not.toThrow();
  });

  test('a Contract’s own Endpoint in a Dependency is a type error', () => {
    const getReceipt = defineEndpoint({
      name: 'getReceipt',
      method: 'GET',
      path: '/receipts',
      visibility: 'public',
      description: 'The latest receipt',
      success: { status: 200, body: z.object({ amount: z.int() }) },
    });

    const declare = () =>
      // @ts-expect-error no Provider's Contract Package exports it
      defineDependency({ endpoints: [getReceipt] });

    expect(declare).not.toThrow();
  });
});

describe('defineDependency fields', () => {
  test('events is a type error: a Subscription takes its Event from the Contract Package', () => {
    const declare = () =>
      defineDependency({
        endpoints: [getPayment],
        // @ts-expect-error a Dependency lists Endpoints only
        events: [paymentSettledV1],
      });

    expect(declare).not.toThrow();
  });

  test.each([
    { what: 'an Endpoint written undefined', declaration: { endpoints: [undefined] } },
    { what: 'endpoints written null', declaration: { endpoints: null } },
    { what: 'endpoints left out', declaration: {} },
    // biome-ignore lint/suspicious/noSparseArray: the hole is what the test writes
    { what: 'a hole in the list', declaration: { endpoints: [, getPayment] } },
  ])('$what does not throw, leaving it to generate to report', ({ declaration }) => {
    const written = declaration as unknown as Parameters<typeof defineDependency>[0];

    expect(() => defineDependency(written)).not.toThrow();
  });
});

describe('a declared Dependency’s containers', () => {
  test('a Dependency freezes itself and its list of Endpoints, keeping each Endpoint', () => {
    const paymentsDependency = defineDependency({ endpoints: [getPayment] });

    expect(Object.isFrozen(paymentsDependency)).toBe(true);
    expect(Object.isFrozen(paymentsDependency.endpoints)).toBe(true);
    expect(paymentsDependency.endpoints[0]).toBe(getPayment);
  });
});
