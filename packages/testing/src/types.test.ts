import type { Client } from '@cf-loom/client';
import {
  type ContractPackage,
  defineCommand,
  defineContract,
  defineDependency,
  defineEndpoint,
  defineEvent,
  defineGroup,
  defineGuard,
  defineRejection,
  defineSubscription,
  type Endpoint,
  type Event,
  type InputOf,
  notFound,
  openEnum,
  openEnumReader,
} from '@cf-loom/contract';
import { exportedSnapshotOf, snapshotOf, validateContract } from '@cf-loom/contract/internal';
import { handle, readersOf } from '@cf-loom/handlers';
import { describe, expect, expectTypeOf, test } from 'vitest';
import { z } from 'zod';
import { providedStandardRejections } from '../test/standard-rejections.ts';
import { type FakeCall, fakeEvent, fakeProvider, type ScriptedAnswer } from './index.ts';

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
  const rootPackage = {
    packageName: 'payments-service',
    originOf: () => undefined,
    exportsOf: () => [],
  };
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
      readonly FakeCall<typeof readers.getPayment>[]
    >();
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
      .once((r) => r.reject({ unknown: 'CARD_EXPIRED' }, { any: 'thing' }))
      // @ts-expect-error a declared body is required
      .once((r) => r.reject('PAYMENT_LOCKED'))
      // @ts-expect-error the Provider resolved notFound to NO_PAYMENT
      .once((r) => r.reject('NOT_FOUND'))
      // @ts-expect-error the body is the declared one
      .otherwise((r) => r.reject('PAYMENT_LOCKED', { lockedAt: 1 }));

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

const settledBody = z.object({
  paymentId: z.uuid(),
  status: openEnumReader(['settled', 'refunded']),
});

const paymentSettledV1 = defineEvent({
  name: 'PaymentSettled',
  version: 1,
  visibility: 'internal',
  description: 'A payment was settled',
  body: settledBody,
});

const paymentAuditedV1 = defineEvent({
  name: 'PaymentAudited',
  version: 1,
  visibility: 'private',
  description: 'A payment was audited',
  body: settledBody,
});

const chargeCardV1 = defineCommand({
  name: 'ChargeCard',
  version: 1,
  description: 'Charges a card',
  body: settledBody,
});

const settledPackage = {
  name: 'payments-service',
  version: '5.1.0',
  endpoints: {},
  events: { paymentSettledV1 },
  standardRejections: providedStandardRejections(),
  exportedSnapshot: { format: 1, defs: {}, endpoints: {}, events: {}, guards: {}, codes: {} },
} as const satisfies ContractPackage;

const PAYMENT_ID = '0b5e1c9a-52f7-4c63-9a0e-3d8f2b7a1c44';

describe('fakeEvent: types', () => {
  test('fakeEvent takes and returns the body a Subscription’s Handler reads, Unknown cases included', () => {
    const settledEvent = settledPackage.events.paymentSettledV1;
    const subscription = defineSubscription({
      name: 'notifyOnSettled',
      description: 'Notify on settled',
      event: settledEvent,
    });
    const { subscriptions } = readersOf({
      commands: {},
      subscriptions: { notifyOnSettled: { element: subscription, reader: settledEvent.body } },
    });
    const handler = handle(subscriptions.notifyOnSettled, () => undefined);
    type Read = Parameters<typeof handler>[0];

    const faked = fakeEvent(settledEvent, {
      paymentId: PAYMENT_ID,
      status: { unknown: 'disputed' },
    });

    expectTypeOf(faked).toEqualTypeOf<Read>();
    expect(faked).toEqual({ paymentId: PAYMENT_ID, status: { unknown: 'disputed' } });
  });

  test('a body of the wrong shape is a type error', () => {
    const settledEvent = settledPackage.events.paymentSettledV1;

    // @ts-expect-error the body has a paymentId, not an id
    const misnamed = () => fakeEvent(settledEvent, { id: PAYMENT_ID, status: 'settled' });
    // @ts-expect-error a value the Open Enum does not declare is its Unknown case
    const bare = () => fakeEvent(settledEvent, { paymentId: PAYMENT_ID, status: 'disputed' });

    expect([misnamed, bare]).toHaveLength(2);
  });

  test('a Command is a type error', () => {
    // @ts-expect-error a Command is never exported, so there is no Provider’s Command to fake
    const faking = () => fakeEvent(chargeCardV1, { paymentId: PAYMENT_ID, status: 'settled' });

    expect(faking).toBeTypeOf('function');
  });

  test('a Private Event is a type error', () => {
    // @ts-expect-error a Private Event is always the Service’s own
    const faking = () => fakeEvent(paymentAuditedV1, { paymentId: PAYMENT_ID, status: 'settled' });

    expect(faking).toBeTypeOf('function');
  });

  test('an Event typed as any Event, its Visibility unknown, is a type error', () => {
    const widened: Event = paymentSettledV1;

    // @ts-expect-error only an Event known to be exported can be a Provider's
    const faking = () => fakeEvent(widened, { paymentId: PAYMENT_ID, status: 'settled' });

    expect(faking).toBeTypeOf('function');
  });
});
