import type { Client } from '@cf-loom/client';
import {
  defineDependency,
  defineEndpoint,
  defineGroup,
  defineGuard,
  defineRejection,
  defineService,
  type Endpoint,
  type InputOf,
  notFound,
  openEnum,
  openEnumReader,
} from '@cf-loom/contract';
import { exportedSnapshotOf, snapshotOf, validateRoot } from '@cf-loom/contract/internal';
import { describe, expect, expectTypeOf, test } from 'vitest';
import { z } from 'zod';
import { type Exportable, providedEndpointsOf } from '../test/provided.ts';
import { aRootPackage } from '../test/root-package.ts';
import { providedStandardRejections } from '../test/standard-rejections.ts';
import {
  fakeProvider,
  type InvalidCall,
  type Script,
  type ScriptedAnswer,
  type Step,
  type StepBuilder,
} from './index.ts';

const apiKey = defineGuard({
  name: 'apiKey',
  description: 'A key per Caller',
  demands: { headers: z.object({ 'x-api-key': z.string() }) },
});

/** The payments Endpoints, with a schema for their Open Enum: as declared, or as read. */
function paymentEndpointsOf<const Stage extends z.ZodType>(stage: Stage) {
  const paymentLocked = defineRejection({
    code: 'PAYMENT_LOCKED',
    status: 409,
    message: 'The payment is locked',
    body: z.object({ lockedAt: z.iso.datetime() }),
  });
  const throttled = defineRejection({
    code: 'THROTTLED',
    status: 429,
    message: 'Too many requests',
    headers: z.object({ 'retry-after': z.int() }),
    body: z.object({ limit: z.int() }),
  });
  const unauthorized = defineRejection({
    code: 'UNAUTHORIZED',
    status: 401,
    message: 'Sign in first',
    headers: z.object({ 'www-authenticate': z.string() }),
  });
  const getPayment = defineEndpoint({
    name: 'getPayment',
    method: 'GET',
    path: '/payments/:paymentId',
    visibility: 'internal',
    description: 'One payment',
    guards: [apiKey],
    input: {
      params: z.object({ paymentId: z.string() }),
      headers: z.object({ 'x-api-key': z.string() }),
    },
    success: { status: 200, body: z.object({ id: z.string(), stage }) },
    rejections: [notFound, paymentLocked],
  });
  const tagPayment = defineEndpoint({
    name: 'tagPayment',
    method: 'PUT',
    path: '/payments/:paymentId/tag',
    visibility: 'internal',
    description: 'Tags a payment',
    input: { params: z.object({ paymentId: z.string() }) },
    success: { status: 204, headers: z.object({ 'x-tag': stage }) },
  });
  const listPayments = defineEndpoint({
    name: 'listPayments',
    method: 'GET',
    path: '/payments',
    visibility: 'internal',
    description: 'Every payment',
    success: { status: 200, body: z.array(z.string()) },
  });
  const refundPayment = defineEndpoint({
    name: 'refundPayment',
    method: 'POST',
    path: '/payments/:paymentId/refund',
    visibility: 'internal',
    description: 'Refunds a payment',
    input: { params: z.object({ paymentId: z.string() }) },
    success: { status: 204 },
    rejections: [throttled, unauthorized],
  });
  return { getPayment, tagPayment, listPayments, refundPayment };
}

const declared = paymentEndpointsOf(openEnum(['pending', 'settled']));
const readers = paymentEndpointsOf(openEnumReader(['pending', 'settled']));

/** The Provider's Contract Package, as `cf-loom package` writes it from its declarations. */
function contractPackageOf<const Endpoints extends Readonly<Record<string, Exportable>>>(
  endpoints: Endpoints,
  declaredEndpoints: readonly Endpoint[],
) {
  const listed = declaredEndpoints as unknown as [Endpoint];
  const group = defineGroup({ name: 'payments', description: 'Payments', endpoints: listed });
  const root = defineService({ name: 'payments-service', groups: [group] });
  const rootPackage = aRootPackage(root, { packageName: 'payments-service' });
  const validated = validateRoot(root, rootPackage);
  if (validated.kind !== 'valid') {
    throw new Error(`The fixture is invalid: ${JSON.stringify(validated.failures)}`);
  }
  const snapshot = snapshotOf(validated);
  if (snapshot.kind !== 'service') {
    throw new Error('The fixture is no Service');
  }
  const exportedSnapshot = exportedSnapshotOf(snapshot);
  const standardRejections = providedStandardRejections({
    notFound: { code: 'NO_PAYMENT', status: 404, message: 'No such payment' },
  });
  const name = 'payments-service';
  const provided = providedEndpointsOf(name, endpoints);
  return {
    name,
    endpoints: provided,
    events: {},
    standardRejections,
    exportedSnapshot,
  };
}

const paymentsDependencyPackage = contractPackageOf(readers, Object.values(declared));
const paymentsDependency = defineDependency({
  provider: paymentsDependencyPackage,
  endpoints: [
    paymentsDependencyPackage.endpoints.getPayment,
    paymentsDependencyPackage.endpoints.tagPayment,
    paymentsDependencyPackage.endpoints.refundPayment,
  ],
});

describe('fakeProvider: types', () => {
  test('on and calls take the names of listed Endpoints only', () => {
    const payments = fakeProvider(paymentsDependency);

    // @ts-expect-error listPayments is exported but not listed
    const unlisted = () => payments.on('listPayments');
    // @ts-expect-error no Endpoint has this name
    const unknown = () => payments.calls('getPayments');

    expect([unlisted, unknown]).toHaveLength(2);
    expectTypeOf(payments.calls('getPayment')).toEqualTypeOf<
      readonly {
        readonly params: { readonly paymentId: string };
        readonly headers: { readonly 'x-api-key': string };
      }[]
    >();
    expectTypeOf(payments.invalidCalls('getPayment')).toEqualTypeOf<readonly InvalidCall[]>();
  });

  test('a call is readonly at every depth', () => {
    const payments = fakeProvider(paymentsDependency);
    type Call = ReturnType<typeof payments.calls<'getPayment'>>[number];

    const writingPart = (call: Call) => {
      // @ts-expect-error a recorded call is never written to
      call.params = { paymentId: 'x' };
    };
    const writingParam = (call: Call) => {
      // @ts-expect-error a recorded call is never written to at any depth
      call.params.paymentId = 'x';
    };

    expect([writingPart, writingParam]).toHaveLength(2);
    expectTypeOf<Call>().toEqualTypeOf<{
      readonly params: { readonly paymentId: string };
      readonly headers: { readonly 'x-api-key': string };
    }>();
  });

  test('verify takes nothing and returns nothing', () => {
    const payments = fakeProvider(paymentsDependency);

    expectTypeOf(payments.verify).toEqualTypeOf<() => void>();
  });

  test('a call is the parsed Input itself, read with no narrowing', () => {
    const payments = fakeProvider(paymentsDependency);

    const paymentId = payments.calls('getPayment')[0]?.params.paymentId;

    expectTypeOf(paymentId).toEqualTypeOf<string | undefined>();
    expect(paymentId).toBeUndefined();
  });

  test('an invalid call holds the Issues of the invalid-input Rejection', () => {
    const payments = fakeProvider(paymentsDependency);

    const issues = payments.invalidCalls('getPayment')[0]?.issues;

    expectTypeOf(issues).toEqualTypeOf<InvalidCall['issues'] | undefined>();
    expect(issues).toBeUndefined();
  });

  test('on(name) is the Script of that name, whose once takes a Step keyed by the Dependency and the name', () => {
    const payments = fakeProvider(paymentsDependency);
    const step: Step<typeof paymentsDependency, 'getPayment'> = (r) => r.reject('NO_PAYMENT');

    const script = payments.on('getPayment').once(step);

    expectTypeOf(script).toEqualTypeOf<Script<typeof paymentsDependency, 'getPayment'>>();
    expect(payments.calls('getPayment')).toEqual([]);
  });

  test('Script, Step and StepBuilder refuse a name the Dependency does not list', () => {
    // @ts-expect-error listPayments is exported but not listed
    type UnlistedScript = Script<typeof paymentsDependency, 'listPayments'>;
    // @ts-expect-error listPayments is exported but not listed
    type UnlistedStep = Step<typeof paymentsDependency, 'listPayments'>;
    // @ts-expect-error no Endpoint has this name
    type UnlistedBuilder = StepBuilder<typeof paymentsDependency, 'getPayments'>;

    expectTypeOf<[UnlistedScript, UnlistedStep, UnlistedBuilder]>().not.toBeNever();
  });

  test('a Dependency written without a list gives on and calls no name', () => {
    const payments = fakeProvider(defineDependency({ provider: paymentsDependency.provider }));

    // @ts-expect-error getPayment is exported but not listed
    const unlisted = () => payments.on('getPayment');

    expect(unlisted).toBeTypeOf('function');
  });

  test('reject takes the Endpoint’s codes, the Provider’s Standard ones included, each with its body', () => {
    const payments = fakeProvider(paymentsDependency);

    payments
      .on('getPayment')
      .once((r) => r.reject('NO_PAYMENT'))
      .once((r) => r.reject('PAYMENT_LOCKED', { lockedAt: '2026-10-19T10:00:00Z' }))
      .once((r) => r.unknownRejection('CARD_EXPIRED', { body: { any: 'thing' } }))
      // @ts-expect-error a declared body is required
      .once((r) => r.reject('PAYMENT_LOCKED'))
      // @ts-expect-error the Provider resolved notFound to NO_PAYMENT
      .once((r) => r.reject('NOT_FOUND'))
      // @ts-expect-error the body is the declared one
      .otherwise((r) => r.reject('PAYMENT_LOCKED', { lockedAt: 1 }));

    expect(payments.calls('getPayment')).toEqual([]);
  });

  test('reject takes one code with its own body, never a code not narrowed to one', () => {
    const payments = fakeProvider(paymentsDependency);
    const code = Math.random() > 0.5 ? ('NO_PAYMENT' as const) : ('PAYMENT_LOCKED' as const);

    payments
      .on('getPayment')
      // @ts-expect-error a code that may be either is paired with neither body
      .once((r) => r.reject(code))
      // @ts-expect-error NO_PAYMENT declares no body, so the body fits only one of the two
      .once((r) => r.reject(code, { lockedAt: '2026-10-19T10:00:00Z' }))
      .otherwise((r) =>
        code === 'PAYMENT_LOCKED'
          ? r.reject(code, { lockedAt: '2026-10-19T10:00:00Z' })
          : r.reject(code),
      );

    expect(payments.calls('getPayment')).toEqual([]);
  });

  test('reject takes { headers, body } for a code that declares headers, never a bare body or none', () => {
    const payments = fakeProvider(paymentsDependency);

    payments
      .on('refundPayment')
      .once((r) => r.reject('THROTTLED', { headers: { 'retry-after': 30 }, body: { limit: 5 } }))
      .once((r) => r.reject('UNAUTHORIZED', { headers: { 'www-authenticate': 'Bearer' } }))
      // @ts-expect-error a code that declares headers takes them
      .once((r) => r.reject('UNAUTHORIZED'))
      // @ts-expect-error a code that declares headers takes { headers, body }, not a bare body
      .once((r) => r.reject('THROTTLED', { limit: 5 }))
      // @ts-expect-error a code that declares a body takes it beside its headers
      .once((r) => r.reject('THROTTLED', { headers: { 'retry-after': 30 } }))
      // @ts-expect-error a code that declares no body takes none beside its headers
      .once((r) => r.reject('UNAUTHORIZED', { headers: { 'www-authenticate': 'B' }, body: {} }))
      // @ts-expect-error a header is typed by its Reader
      .otherwise((r) => r.reject('UNAUTHORIZED', { headers: { 'www-authenticate': 3 } }));

    expect(payments.calls('refundPayment')).toEqual([]);
  });

  test('reject takes no body for a code that declares none', () => {
    const payments = fakeProvider(paymentsDependency);

    payments
      .on('getPayment')
      // @ts-expect-error NO_PAYMENT declares no body, so none is given, not even undefined
      .once((r) => r.reject('NO_PAYMENT', undefined));

    expect(payments.calls('getPayment')).toEqual([]);
  });

  test('success takes the Success as a Caller reads it: an Open Enum’s Unknown case, never a bare string', () => {
    const payments = fakeProvider(paymentsDependency);

    payments
      .on('getPayment')
      .once((r) => r.success({ id: 'pay-1', stage: { unknown: 'refunded' } }))
      // @ts-expect-error a value the Open Enum does not declare is its Unknown case
      .otherwise((r) => r.success({ id: 'pay-1', stage: 'refunded' }));
    const withBody = { headers: { 'x-tag': 'settled' as const }, body: { x: 1 } };
    payments
      .on('tagPayment')
      .once((r) => r.success({ headers: { 'x-tag': 'settled' } }))
      // @ts-expect-error a headers-only Success takes no body, in a literal or not
      .once((r) => r.success(withBody))
      // @ts-expect-error declared headers are passed with the Success
      .otherwise((r) => r.success());

    expect(payments.calls('tagPayment')).toEqual([]);
  });

  test('a step receives the Endpoint’s Input as the Provider parses it, and returns a ScriptedAnswer', () => {
    const payments = fakeProvider(paymentsDependency);

    payments.on('getPayment').otherwise((builder, input) => {
      expectTypeOf(input).toEqualTypeOf<InputOf<typeof readers.getPayment>>();
      const answer = builder.success({ id: input.params.paymentId, stage: 'pending' });
      expectTypeOf(answer).toEqualTypeOf<ScriptedAnswer>();
      return answer;
    });

    expect(payments.calls('getPayment')).toEqual([]);
  });

  test('client() with headers is a client with those headers configured', () => {
    const payments = fakeProvider(paymentsDependency);

    const configured = payments.client({ headers: { 'x-api-key': 'k' } });
    const bare = payments.client();

    expectTypeOf(configured).toEqualTypeOf<Client<typeof paymentsDependency, 'x-api-key'>>();
    expectTypeOf(bare).toEqualTypeOf<Client<typeof paymentsDependency>>();
    expect(Object.keys(configured)).toEqual(['getPayment', 'tagPayment', 'refundPayment']);
  });
});
