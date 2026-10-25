import {
  type ContractPackage,
  defineContract,
  defineDependency,
  defineEndpoint,
  defineGroup,
  defineRejection,
  type Endpoint,
  notFound,
  openEnum,
  openEnumReader,
} from '@cf-loom/contract';
import { exportedSnapshotOf, snapshotOf, validateContract } from '@cf-loom/contract/internal';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { aRootPackage } from '../test/root-package.ts';
import { providedStandardRejections } from '../test/standard-rejections.ts';
import { fakeProvider } from './index.ts';

/**
 * The Endpoints of a payments Provider, declared with a schema for each Open Enum: as the
 * Provider writes them, or as its Contract Package rebuilds them, with Reader schemas.
 */
function paymentEndpointsOf<const Stage extends z.ZodType, const Reason extends z.ZodType>(
  stage: Stage,
  reason: Reason,
) {
  const paymentLocked = defineRejection({
    code: 'PAYMENT_LOCKED',
    status: 409,
    message: 'The payment is locked',
    body: z.object({ lockedAt: z.iso.datetime(), reason }),
  });
  const getPayment = defineEndpoint({
    name: 'getPayment',
    method: 'GET',
    path: '/payments/:paymentId',
    visibility: 'internal',
    description: 'One payment',
    input: { params: z.object({ paymentId: z.string() }) },
    success: {
      status: 200,
      headers: z.object({ 'x-stage': stage, 'x-count': z.int() }),
      body: z.object({ id: z.string(), amount: z.int().positive(), stage }),
    },
    rejections: [notFound, paymentLocked],
  });
  const cancelPayment = defineEndpoint({
    name: 'cancelPayment',
    method: 'DELETE',
    path: '/payments/:paymentId',
    visibility: 'internal',
    description: 'Cancels a payment',
    input: { params: z.object({ paymentId: z.string() }) },
    success: { status: 204 },
  });
  const checkPayment = defineEndpoint({
    name: 'checkPayment',
    method: 'GET',
    path: '/payments/:paymentId/check',
    visibility: 'internal',
    description: 'Checks a payment, answering its count in a header',
    input: { params: z.object({ paymentId: z.string() }) },
    success: { status: 204, headers: z.object({ 'x-count': z.int() }) },
  });
  const capturePayment = defineEndpoint({
    name: 'capturePayment',
    method: 'POST',
    path: '/payments/:paymentId/capture',
    visibility: 'internal',
    description: 'Captures a payment',
    input: { params: z.object({ paymentId: z.string() }), body: z.object({ amount: z.int() }) },
    success: { status: 200, body: z.object({ amount: z.int() }) },
  });
  return { getPayment, cancelPayment, checkPayment, capturePayment };
}

const declared = paymentEndpointsOf(openEnum(['pending', 'settled']), openEnum(['fraud']));
const readers = paymentEndpointsOf(
  openEnumReader(['pending', 'settled']),
  openEnumReader(['fraud']),
);

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
  endpoints: [
    readers.getPayment,
    readers.cancelPayment,
    readers.checkPayment,
    readers.capturePayment,
  ],
});

const params = { paymentId: 'pay-1' };
const at = 'https://payments-service.test/payments/pay-1';
const success = {
  headers: { 'x-stage': 'pending', 'x-count': 1 },
  body: { id: 'pay-1', amount: 5, stage: 'pending' },
} as const;

describe('fakeProvider: steps', () => {
  test('once steps answer in order, then the last otherwise answers every other request', async () => {
    const payments = fakeProvider(paymentsDependency);
    payments
      .on('getPayment')
      .once((r) => r.reject('NO_PAYMENT'))
      .otherwise((r) => r.fault({ committed: 'no', retryable: false }))
      .once((r) => r.success(success))
      .otherwise((r) => r.success({ ...success, body: { ...success.body, amount: 9 } }));
    const client = payments.client();

    const outcomes = [
      await client.getPayment({ params }),
      await client.getPayment({ params }),
      await client.getPayment({ params }),
      await client.getPayment({ params }),
    ];

    expect(outcomes.map((outcome) => outcome.kind)).toEqual([
      'rejection',
      'success',
      'success',
      'success',
    ]);
    expect(outcomes[3]).toMatchObject({ value: { amount: 9 } });
  });

  test('a step may be async', async () => {
    const payments = fakeProvider(paymentsDependency);
    payments.on('cancelPayment').otherwise(async (builder) => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      return builder.success();
    });

    const outcome = await payments.client().cancelPayment({ params });

    expect(outcome).toEqual({ kind: 'success', value: undefined, headers: {} });
  });

  test('a Success carries its headers as text, a number and an Open Enum Unknown case included', async () => {
    const payments = fakeProvider(paymentsDependency);
    const lost = { unknown: 'lost' };
    payments.on('getPayment').otherwise((r) =>
      r.success({
        headers: { 'x-stage': lost, 'x-count': 2 },
        body: { id: 'pay-1', amount: 5, stage: lost },
      }),
    );

    const response = await payments.fetch(at, {});
    const outcome = await payments.client().getPayment({ params });

    expect([response.headers.get('x-stage'), response.headers.get('x-count')]).toEqual([
      'lost',
      '2',
    ]);
    expect(outcome).toEqual({
      kind: 'success',
      value: { id: 'pay-1', amount: 5, stage: lost },
      headers: { 'x-stage': lost, 'x-count': 2 },
    });
  });

  test('success() answers a 204 with no body, and a 204 with headers its headers alone', async () => {
    const payments = fakeProvider(paymentsDependency);
    payments.on('cancelPayment').otherwise((r) => r.success());
    payments.on('checkPayment').otherwise((r) => r.success({ headers: { 'x-count': 3 } }));

    const cancelled = await payments.fetch(at, { method: 'DELETE' });
    const checked = await payments.client().checkPayment({ params });

    expect([cancelled.status, await cancelled.text()]).toEqual([204, '']);
    expect(checked).toEqual({ kind: 'success', value: undefined, headers: { 'x-count': 3 } });
  });

  test('reject(code) answers a declared code with its status, a Standard one by the Provider’s code', async () => {
    const payments = fakeProvider(paymentsDependency);
    payments.on('getPayment').otherwise((r) => r.reject('NO_PAYMENT'));

    const response = await payments.fetch(at, {});
    const outcome = await payments.client().getPayment({ params });

    expect(response.status).toBe(404);
    expect(outcome).toEqual({
      kind: 'rejection',
      known: true,
      code: 'NO_PAYMENT',
      message: 'No such payment',
      body: undefined,
    });
  });

  test('reject(code, body) answers its body as its reader reads it, an Unknown case included', async () => {
    const payments = fakeProvider(paymentsDependency);
    const body = { lockedAt: '2026-10-19T10:00:00Z', reason: { unknown: 'chargeback' } };
    payments.on('getPayment').otherwise((r) => r.reject('PAYMENT_LOCKED', body));

    const response = await payments.fetch(at, {});
    const outcome = await payments.client().getPayment({ params });

    expect(response.status).toBe(409);
    expect(outcome).toEqual({
      kind: 'rejection',
      known: true,
      code: 'PAYMENT_LOCKED',
      message: 'The payment is locked',
      body,
    });
  });

  test('reject on invalid input answers its issues as the Provider’s Reader writes them, a code only that Reader declares included', async () => {
    const provider = contractPackageOf(readers, Object.values(declared));
    const providersReader = z.object({
      issues: z.array(
        z.object({
          code: openEnumReader(['too_deep', 'too_small']),
          in: openEnumReader(['body', 'headers', 'params', 'query']),
          message: z.string(),
          path: z.array(z.union([z.string(), z.number()])),
        }),
      ),
    });
    const { invalidInput } = provider.standardRejections;
    const dependency = defineDependency({
      provider: {
        ...provider,
        standardRejections: {
          ...provider.standardRejections,
          invalidInput: { ...invalidInput, body: providersReader },
        },
      },
      endpoints: [readers.getPayment],
    });
    const payments = fakeProvider(dependency);
    const issue = {
      in: 'body' as const,
      path: ['amount'],
      code: 'too_deep' as const,
      message: 'Too deep',
    };
    payments.on('getPayment').otherwise((r) => r.reject('INVALID_INPUT', { issues: [issue] }));

    const response = await payments.fetch(at, {});
    const outcome = await payments.client().getPayment({ params });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      rejection: { code: 'INVALID_INPUT', message: 'Invalid input', body: { issues: [issue] } },
    });
    expect(outcome).toMatchObject({
      known: true,
      code: 'INVALID_INPUT',
      body: { issues: [issue] },
    });
  });

  test('reject({ unknown }) answers 422, its message the code unless given, and the client does not know it', async () => {
    const payments = fakeProvider(paymentsDependency);
    payments
      .on('getPayment')
      .once((r) => r.reject({ unknown: 'CARD_EXPIRED' }, { expiredAt: '2026-01' }))
      .once((r) => r.reject({ unknown: 'CARD_EXPIRED', message: 'The card expired' }, null));

    const response = await payments.fetch(at, {});
    const outcome = await payments.client().getPayment({ params });

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      rejection: { code: 'CARD_EXPIRED', message: 'CARD_EXPIRED', body: { expiredAt: '2026-01' } },
    });
    expect(outcome).toEqual({
      kind: 'rejection',
      known: false,
      code: 'CARD_EXPIRED',
      message: 'The card expired',
      body: null,
    });
  });

  test('fault answers 503 when retryable and 500 otherwise, saying Internal error by default', async () => {
    const payments = fakeProvider(paymentsDependency);
    payments
      .on('getPayment')
      .once((r) => r.fault({ committed: 'unknown', retryable: true }))
      .once((r) => r.fault({ committed: 'yes', retryable: false, message: 'Done, but lost' }));

    const responses = [await payments.fetch(at, {}), await payments.fetch(at, {})];
    const bodies = await Promise.all(responses.map((response) => response.json()));

    expect(responses.map((response) => response.status)).toEqual([503, 500]);
    expect(bodies).toEqual([
      { fault: { committed: 'unknown', retryable: true, message: 'Internal error' } },
      { fault: { committed: 'yes', retryable: false, message: 'Done, but lost' } },
    ]);
  });

  test.each([
    ['RETIRED', 410, 'no'],
    ['NO_SUCH_ENDPOINT', 404, 'no'],
    ['BODY_TOO_LARGE', 413, 'no'],
    ['INVALID_OUTCOME', 500, 'unknown'],
  ] as const)(
    'fault({ code: %s }) answers its status and its committed',
    async (code, status, committed) => {
      const payments = fakeProvider(paymentsDependency);
      payments.on('getPayment').otherwise((r) => r.fault({ code }));

      const response = await payments.fetch(at, {});
      const outcome = await payments.client().getPayment({ params });

      expect(response.status).toBe(status);
      expect(outcome).toMatchObject({ kind: 'fault', code, committed, retryable: false });
    },
  );

  test('an abort while a step waits rejects fetch with the signal’s reason', async () => {
    const payments = fakeProvider(paymentsDependency);
    const waiting = Promise.withResolvers<void>();
    payments.on('getPayment').otherwise(async (builder) => {
      await waiting.promise;
      return builder.reject('NO_PAYMENT');
    });
    const controller = new AbortController();
    const reason = new Error('Gave up');

    const answering = payments.fetch(at, { signal: controller.signal });
    controller.abort(reason);

    await expect(answering).rejects.toBe(reason);
    waiting.resolve();
  });

  test('steps are taken in the order requests arrived, whichever finishes reading first', async () => {
    const payments = fakeProvider(paymentsDependency);
    payments
      .on('capturePayment')
      .once((r, { body }) => r.success({ amount: body.amount }))
      .once((r) => r.success({ amount: 0 }));
    const gated = gatedBodyOf(1);

    const first = capture(payments, gated.body);
    const second = capture(payments, '{"amount":2}');
    await settling();
    gated.open();
    const bodies = await Promise.all([first, second].map(async (sent) => (await sent).json()));

    expect(bodies).toEqual([{ amount: 1 }, { amount: 0 }]);
  });

  test('an invalid request between two valid ones takes no turn from the first', async () => {
    const payments = fakeProvider(paymentsDependency);
    payments
      .on('capturePayment')
      .once((r, { body }) => r.success({ amount: body.amount }))
      .once((r) => r.success({ amount: 0 }));
    const gated = gatedBodyOf(1);

    const first = capture(payments, gated.body);
    const invalid = await capture(payments, '{"amount":"x"}');
    const third = capture(payments, '{"amount":3}');
    await settling();
    gated.open();
    const bodies = await Promise.all([first, third].map(async (sent) => (await sent).json()));

    expect(invalid.status).toBe(400);
    expect(bodies).toEqual([{ amount: 1 }, { amount: 0 }]);
  });

  test('a request aborted while its body is read holds no later request back', async () => {
    const payments = fakeProvider(paymentsDependency);
    payments.on('capturePayment').otherwise((r, { body }) => r.success({ amount: body.amount }));
    const controller = new AbortController();
    const reason = new Error('Gave up');

    const first = capture(payments, gatedBodyOf(1).body, controller.signal);
    const second = capture(payments, '{"amount":2}');
    await settling();
    controller.abort(reason);

    await expect(first).rejects.toBe(reason);
    expect(await (await second).json()).toEqual({ amount: 2 });
  });

  test('a request aborted while it waits for its turn records no call and takes no step', async () => {
    const payments = fakeProvider(paymentsDependency);
    payments
      .on('capturePayment')
      .once((r, { body }) => r.success({ amount: body.amount }))
      .once((r, { body }) => r.success({ amount: body.amount + 10 }))
      .once((r) => r.success({ amount: 0 }));
    const gated = gatedBodyOf(1);
    const controller = new AbortController();
    const reason = new Error('Gave up');

    const first = capture(payments, gated.body);
    const second = capture(payments, '{"amount":2}', controller.signal);
    await settling();
    controller.abort(reason);
    gated.open();
    const third = capture(payments, '{"amount":3}');
    const bodies = await Promise.all([first, third].map(async (sent) => (await sent).json()));

    await expect(second).rejects.toBe(reason);
    expect(bodies).toEqual([{ amount: 1 }, { amount: 13 }]);
    expect(payments.calls('capturePayment')).toHaveLength(2);
  });

  test('a mistake gives up its turn, so the next request is answered once a step is added', async () => {
    const payments = fakeProvider(paymentsDependency);

    const unscripted = capture(payments, '{"amount":1}');
    await expect(unscripted).rejects.toThrow('it was never scripted');
    payments.on('capturePayment').otherwise((r, { body }) => r.success({ amount: body.amount }));
    const answered = await capture(payments, '{"amount":2}');

    expect(await answered.json()).toEqual({ amount: 2 });
  });
});

/** A JSON body whose stream is held until `open()` is called. */
function gatedBodyOf(amount: number) {
  const gate = Promise.withResolvers<void>();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      await gate.promise;
      controller.enqueue(new TextEncoder().encode(JSON.stringify({ amount })));
      controller.close();
    },
  });
  return { body, open: () => gate.resolve() };
}

/** A capture of the payment, its body JSON text or a stream. */
function capture(
  payments: ReturnType<typeof fakeProvider<typeof paymentsDependency>>,
  body: string | ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): Promise<Response> {
  const headers = { 'content-type': 'application/json' };
  const init: RequestInit = { method: 'POST', headers, body, duplex: 'half' };
  return payments.fetch(`${at}/capture`, signal === undefined ? init : { ...init, signal });
}

/** Lets every request sent so far read what it can. */
function settling(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 5));
}
