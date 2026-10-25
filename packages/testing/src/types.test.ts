import type { Client } from '@cf-loom/client';
import {
  type ContractPackage,
  defineContract,
  defineDependency,
  defineEndpoint,
  defineGroup,
  defineGuard,
  defineRejection,
  type Endpoint,
  type InputOf,
  notFound,
  openEnum,
  openEnumReader,
} from '@cf-loom/contract';
import { exportedSnapshotOf, snapshotOf, validateContract } from '@cf-loom/contract/internal';
import { describe, expect, expectTypeOf, test } from 'vitest';
import { z } from 'zod';
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
  return { getPayment, tagPayment, listPayments };
}

const declared = paymentEndpointsOf(openEnum(['pending', 'settled']));
const readers = paymentEndpointsOf(openEnumReader(['pending', 'settled']));

/** The Provider's Contract Package, as `cf-loom package` writes it from its declarations. */
function contractPackageOf<const Endpoints extends ContractPackage['endpoints']>(
  endpoints: Endpoints,
  declaredEndpoints: readonly Endpoint[],
) {
  const listed = declaredEndpoints as unknown as [Endpoint];
  const group = defineGroup({ name: 'payments', description: 'Payments', endpoints: listed });
  const root = defineContract({ name: 'payments-service', groups: [group] });
  const rootPackage = aRootPackage(root, { packageName: 'payments-service' });
  const validated = validateContract(root, rootPackage);
  if (validated.kind !== 'valid') {
    throw new Error(`The fixture is invalid: ${JSON.stringify(validated.failures)}`);
  }
  const context = { generator: 'test', packages: [], committed: undefined, now: 0 };
  const snapshot = snapshotOf(validated, context);
  if (snapshot.kind !== 'service') {
    throw new Error('The fixture is no Service');
  }
  const exportedSnapshot = exportedSnapshotOf(snapshot);
  const standardRejections = providedStandardRejections({
    notFound: { code: 'NO_PAYMENT', status: 404, message: 'No such payment' },
  });
  const name = 'payments-service';
  return { name, version: '1.0.0', endpoints, events: {}, standardRejections, exportedSnapshot };
}

const paymentsDependency = defineDependency({
  provider: contractPackageOf(readers, Object.values(declared)),
  endpoints: [readers.getPayment, readers.tagPayment],
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
      readonly InputOf<typeof readers.getPayment>[]
    >();
    expectTypeOf(payments.invalidCalls('getPayment')).toEqualTypeOf<readonly InvalidCall[]>();
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

  test('reject given a code that may be one requiring a body requires the body', () => {
    const payments = fakeProvider(paymentsDependency);
    const code = Math.random() > 0.5 ? ('NO_PAYMENT' as const) : ('PAYMENT_LOCKED' as const);

    payments
      .on('getPayment')
      // @ts-expect-error PAYMENT_LOCKED declares a body, so a code that may be it takes one
      .once((r) => r.reject(code))
      .otherwise((r) => r.reject(code, { lockedAt: '2026-10-19T10:00:00Z' }));

    expect(payments.calls('getPayment')).toEqual([]);
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
    payments
      .on('tagPayment')
      .once((r) => r.success({ headers: { 'x-tag': 'settled' } }))
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
    expect(Object.keys(configured)).toEqual(['getPayment', 'tagPayment']);
  });
});
