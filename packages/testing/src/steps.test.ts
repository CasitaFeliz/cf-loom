import {
  defineDependency,
  defineEndpoint,
  defineGroup,
  defineRejection,
  defineService,
  type Endpoint,
  notFound,
  openEnum,
  openEnumReader,
} from '@cf-loom/contract';
import { exportedSnapshotOf, snapshotOf, validateRoot } from '@cf-loom/contract/internal';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { type Exportable, providedEndpointsOf } from '../test/provided.ts';
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
  return { getPayment, cancelPayment, checkPayment, capturePayment, refundPayment };
}

const declared = paymentEndpointsOf(openEnum(['pending', 'settled']), openEnum(['fraud']));
const readers = paymentEndpointsOf(
  openEnumReader(['pending', 'settled']),
  openEnumReader(['fraud']),
);

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
    paymentsDependencyPackage.endpoints.cancelPayment,
    paymentsDependencyPackage.endpoints.checkPayment,
    paymentsDependencyPackage.endpoints.capturePayment,
    paymentsDependencyPackage.endpoints.refundPayment,
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
    expect(outcomes[3]).toMatchObject({ body: { amount: 9 } });
  });

  test('a step may be async', async () => {
    const payments = fakeProvider(paymentsDependency);
    payments.on('cancelPayment').otherwise(async (builder) => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      return builder.success();
    });

    const outcome = await payments.client().cancelPayment({ params });

    expect(outcome).toStrictEqual({ kind: 'success', status: 204 });
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

    const response = await payments.fetch(new Request(at));
    const outcome = await payments.client().getPayment({ params });

    expect([response.headers.get('x-stage'), response.headers.get('x-count')]).toEqual([
      'lost',
      '2',
    ]);
    expect(outcome).toEqual({
      kind: 'success',
      status: 200,
      headers: { 'x-stage': lost, 'x-count': 2 },
      body: { id: 'pay-1', amount: 5, stage: lost },
    });
  });

  test('success() answers a 204 with no body, and a 204 with headers its headers alone', async () => {
    const payments = fakeProvider(paymentsDependency);
    payments.on('cancelPayment').otherwise((r) => r.success());
    payments.on('checkPayment').otherwise((r) => r.success({ headers: { 'x-count': 3 } }));

    const cancelled = await payments.fetch(new Request(at, { method: 'DELETE' }));
    const checked = await payments.client().checkPayment({ params });

    expect([cancelled.status, await cancelled.text()]).toEqual([204, '']);
    expect(checked).toStrictEqual({ kind: 'success', status: 204, headers: { 'x-count': 3 } });
  });

  test('reject(code) answers a declared code with its status, a Standard one by the Provider’s code', async () => {
    const payments = fakeProvider(paymentsDependency);
    payments.on('getPayment').otherwise((r) => r.reject('NO_PAYMENT'));

    const response = await payments.fetch(new Request(at));
    const outcome = await payments.client().getPayment({ params });

    expect(response.status).toBe(404);
    expect(outcome).toStrictEqual({
      kind: 'rejection',
      source: 'provider',
      code: 'NO_PAYMENT',
      status: 404,
      message: 'No such payment',
    });
  });

  test('reject(code, body) answers its body as its reader reads it, an Unknown case included', async () => {
    const payments = fakeProvider(paymentsDependency);
    const body = { lockedAt: '2026-10-19T10:00:00Z', reason: { unknown: 'chargeback' } };
    payments.on('getPayment').otherwise((r) => r.reject('PAYMENT_LOCKED', body));

    const response = await payments.fetch(new Request(at));
    const outcome = await payments.client().getPayment({ params });

    expect(response.status).toBe(409);
    expect(outcome).toEqual({
      kind: 'rejection',
      source: 'provider',
      code: 'PAYMENT_LOCKED',
      status: 409,
      message: 'The payment is locked',
      body,
    });
  });

  test('reject(code, { headers, body }) answers its headers as text beside its body, as its readers read them', async () => {
    const payments = fakeProvider(paymentsDependency);
    payments
      .on('refundPayment')
      .otherwise((r) =>
        r.reject('THROTTLED', { headers: { 'retry-after': 30 }, body: { limit: 5 } }),
      );

    const response = await payments.fetch(new Request(`${at}/refund`, { method: 'POST' }));
    const outcome = await payments.client().refundPayment({ params });

    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('30');
    expect(outcome).toStrictEqual({
      kind: 'rejection',
      source: 'provider',
      code: 'THROTTLED',
      status: 429,
      message: 'Too many requests',
      headers: { 'retry-after': 30 },
      body: { limit: 5 },
    });
  });

  test('reject(code, { headers }) answers the headers of a code that declares no body', async () => {
    const payments = fakeProvider(paymentsDependency);
    const challenge = 'Bearer realm="payments"';
    payments
      .on('refundPayment')
      .otherwise((r) => r.reject('UNAUTHORIZED', { headers: { 'www-authenticate': challenge } }));

    const outcome = await payments.client().refundPayment({ params });

    expect(outcome).toStrictEqual({
      kind: 'rejection',
      source: 'provider',
      code: 'UNAUTHORIZED',
      status: 401,
      message: 'Sign in first',
      headers: { 'www-authenticate': challenge },
    });
  });

  test('a scripted Rejection header that breaks its reader or cannot travel is a mistake at headers', async () => {
    const payments = fakeProvider(paymentsDependency);
    payments
      .on('refundPayment')
      .otherwise((r) =>
        r.reject('UNAUTHORIZED', { headers: { 'www-authenticate': 'Bearer\nrealm' } }),
      );

    const calling = payments.client().refundPayment({ params });

    await expect(calling).rejects.toThrow(
      [
        'payments-service: refundPayment: the scripted UNAUTHORIZED headers break their reader or cannot travel',
        'payments-service: refundPayment: headers.www-authenticate invalid_format: The header value cannot travel as HTTP field text',
      ].join('\n'),
    );
  });

  test('unknownRejection of a code another Endpoint declares answers it with its declared headers', async () => {
    const payments = fakeProvider(paymentsDependency);
    const scripted = { headers: { 'retry-after': 7 }, body: { limit: 1 } };
    payments.on('cancelPayment').otherwise((r) => r.unknownRejection('THROTTLED', scripted));

    const response = await payments.fetch(new Request(at, { method: 'DELETE' }));
    const outcome = await payments.client().cancelPayment({ params });

    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('7');
    expect(outcome).toMatchObject({ kind: 'unknown-rejection', code: 'THROTTLED' });
  });

  test('unknownRejection of a declared code with no headers, given some, is a mistake', async () => {
    const payments = fakeProvider(paymentsDependency);
    payments
      .on('cancelPayment')
      .otherwise((r) => r.unknownRejection('NO_PAYMENT', { headers: { 'x-note': 'a' } }));

    const calling = payments.client().cancelPayment({ params });

    await expect(calling).rejects.toThrow(
      [
        'payments-service: cancelPayment: the scripted NO_PAYMENT headers break their reader or cannot travel',
        'payments-service: cancelPayment: headers invalid_type: Expected no value',
      ].join('\n'),
    );
  });

  test('unknownRejection of a code no Contract declares takes no headers', async () => {
    const payments = fakeProvider(paymentsDependency);
    payments
      .on('cancelPayment')
      .otherwise((r) => r.unknownRejection('CARD_EXPIRED', { headers: { 'x-note': 'a' } }));

    const calling = payments.client().cancelPayment({ params });

    await expect(calling).rejects.toThrow(
      "payments-service: cancelPayment: r.unknownRejection takes headers only for a code the Provider's Contract declares",
    );
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
      endpoints: [paymentsDependency.provider.endpoints.getPayment],
    });
    const payments = fakeProvider(dependency);
    const issue = {
      in: 'body' as const,
      path: ['amount'],
      code: 'too_deep' as const,
      message: 'Too deep',
    };
    payments.on('getPayment').otherwise((r) => r.reject('INVALID_INPUT', { issues: [issue] }));

    const response = await payments.fetch(new Request(at));
    const outcome = await payments.client().getPayment({ params });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      rejection: { code: 'INVALID_INPUT', message: 'Invalid input', body: { issues: [issue] } },
    });
    expect(outcome).toMatchObject({
      kind: 'rejection',
      code: 'INVALID_INPUT',
      body: { issues: [issue] },
    });
  });

  test('unknownRejection(code) answers 422 with the code as its message and no body, and the client receives an unknown code', async () => {
    const payments = fakeProvider(paymentsDependency);
    payments.on('getPayment').otherwise((r) => r.unknownRejection('CARD_EXPIRED'));

    const response = await payments.fetch(new Request(at));
    const outcome = await payments.client().getPayment({ params });

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      rejection: { code: 'CARD_EXPIRED', message: 'CARD_EXPIRED' },
    });
    expect(outcome).toStrictEqual({
      kind: 'unknown-rejection',
      source: 'provider',
      code: 'CARD_EXPIRED',
      status: 422,
      message: 'CARD_EXPIRED',
    });
  });

  test('unknownRejection(code, { message, body }) carries both', async () => {
    const payments = fakeProvider(paymentsDependency);
    const scripted = { message: 'The card expired', body: { expiredAt: '2026-01' } };
    payments.on('getPayment').otherwise((r) => r.unknownRejection('CARD_EXPIRED', scripted));

    const response = await payments.fetch(new Request(at));

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ rejection: { code: 'CARD_EXPIRED', ...scripted } });
  });

  test('unknownRejection of a code another Endpoint declares answers its declared status, message and body, as a later Provider adding it would', async () => {
    const payments = fakeProvider(paymentsDependency);
    const body = { lockedAt: '2026-10-19T10:00:00Z', reason: { unknown: 'chargeback' } };
    payments.on('capturePayment').otherwise((r) => r.unknownRejection('PAYMENT_LOCKED', { body }));

    const response = await capture(payments, '{"amount":1}');

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      rejection: {
        code: 'PAYMENT_LOCKED',
        message: 'The payment is locked',
        body: { lockedAt: '2026-10-19T10:00:00Z', reason: 'chargeback' },
      },
    });
  });

  test('unknownRejection of a code another Endpoint declares takes the message given', async () => {
    const payments = fakeProvider(paymentsDependency);
    const body = { lockedAt: '2026-10-19T10:00:00Z', reason: 'fraud' };
    const message = 'Locked for review';
    payments
      .on('capturePayment')
      .otherwise((r) => r.unknownRejection('PAYMENT_LOCKED', { message, body }));

    const response = await capture(payments, '{"amount":1}');

    expect(await response.json()).toMatchObject({ rejection: { code: 'PAYMENT_LOCKED', message } });
  });

  test('unknownRejection of a code another Endpoint declares, with a body that breaks its reader, is a mistake listing the Issues', async () => {
    const payments = fakeProvider(paymentsDependency);
    payments
      .on('capturePayment')
      .otherwise((r) => r.unknownRejection('PAYMENT_LOCKED', { body: { lockedAt: 'now' } }));

    const calling = capture(payments, '{"amount":1}');

    await expect(calling).rejects.toThrow(
      [
        'payments-service: capturePayment: the scripted PAYMENT_LOCKED body breaks its reader',
        'payments-service: capturePayment: body.lockedAt invalid_format: ',
      ].join('\n'),
    );
  });

  test('unknownRejection of a code an exported Endpoint the Dependency does not list declares answers it as declared', async () => {
    const dependency = defineDependency({
      provider: paymentsDependency.provider,
      endpoints: [paymentsDependency.provider.endpoints.capturePayment],
    });
    const payments = fakeProvider(dependency);
    const body = { lockedAt: '2026-10-19T10:00:00Z', reason: 'fraud' };
    payments.on('capturePayment').otherwise((r) => r.unknownRejection('PAYMENT_LOCKED', { body }));

    const response = await payments.fetch(
      new Request(`${at}/capture`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{"amount":1}',
      }),
    );

    expect(response.status).toBe(409);
  });

  test('unknownRejection of a declared code with no body, given a body, is a mistake', async () => {
    const payments = fakeProvider(paymentsDependency);
    payments
      .on('capturePayment')
      .otherwise((r) => r.unknownRejection('NO_PAYMENT', { body: { x: 1 } }));

    const calling = capture(payments, '{"amount":1}');

    await expect(calling).rejects.toThrow(
      [
        'payments-service: capturePayment: the scripted NO_PAYMENT body breaks its reader',
        'payments-service: capturePayment: body invalid_type: Expected no value',
      ].join('\n'),
    );
  });

  test('a body scripted for a Success that declares none is a mistake at success.body', async () => {
    const payments = fakeProvider(paymentsDependency);
    // @ts-expect-error cancelPayment's Success declares no body
    payments.on('cancelPayment').otherwise((r) => r.success({ x: 1 }));

    const calling = payments.fetch(new Request(at, { method: 'DELETE' }));

    await expect(calling).rejects.toThrow(
      [
        'payments-service: cancelPayment: the scripted Success breaks its readers',
        'payments-service: cancelPayment: success.body invalid_type: Expected no value',
      ].join('\n'),
    );
  });

  test('a body scripted beside the headers of a headers-only Success is a mistake at success.body', async () => {
    const payments = fakeProvider(paymentsDependency);
    const scripted = { headers: { 'x-count': 1 }, body: { x: 1 } };
    payments.on('checkPayment').otherwise((r) => r.success(scripted as never));

    const calling = payments.fetch(new Request(`${at}/check`));

    await expect(calling).rejects.toThrow(
      [
        'payments-service: checkPayment: the scripted Success breaks its readers',
        'payments-service: checkPayment: success.body invalid_type: Expected no value',
      ].join('\n'),
    );
  });

  test('unknownRejection options cannot replace the kind or the code it scripts', async () => {
    const payments = fakeProvider(paymentsDependency);
    const options = { kind: 'success', code: 'NO_PAYMENT' } as never;
    payments.on('getPayment').otherwise((r) => r.unknownRejection('CARD_EXPIRED', options));

    const response = await payments.fetch(new Request(at));

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      rejection: { code: 'CARD_EXPIRED', message: 'CARD_EXPIRED' },
    });
  });

  test('unknownRejection of the Provider’s not-found code, on an Endpoint that does not list it, answers 404 with its message and no body', async () => {
    const payments = fakeProvider(paymentsDependency);
    payments.on('capturePayment').otherwise((r) => r.unknownRejection('NO_PAYMENT'));

    const response = await capture(payments, '{"amount":1}');

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      rejection: { code: 'NO_PAYMENT', message: 'No such payment' },
    });
  });

  test('fault answers 503 when retryable and 500 otherwise, saying Internal error by default', async () => {
    const payments = fakeProvider(paymentsDependency);
    payments
      .on('getPayment')
      .once((r) => r.fault({ committed: 'unknown', retryable: true }))
      .once((r) => r.fault({ committed: 'yes', retryable: false, message: 'Done, but lost' }));

    const responses = [
      await payments.fetch(new Request(at)),
      await payments.fetch(new Request(at)),
    ];
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
    ['METHOD_NOT_ALLOWED', 405, 'no'],
    ['BODY_TOO_LARGE', 413, 'no'],
    ['INVALID_OUTCOME', 500, 'unknown'],
  ] as const)(
    'fault({ code: %s }) answers its status and its committed',
    async (code, status, committed) => {
      const payments = fakeProvider(paymentsDependency);
      payments.on('getPayment').otherwise((r) => r.fault({ code }));

      const response = await payments.fetch(new Request(at));
      const outcome = await payments.client().getPayment({ params });

      expect(response.status).toBe(status);
      expect(outcome).toMatchObject({
        kind: 'fault',
        source: 'provider',
        status,
        code,
        committed,
        retryable: false,
      });
    },
  );

  test('fault({ code: METHOD_NOT_ALLOWED }) carries Allow with the other methods the Provider takes on that path', async () => {
    const payments = fakeProvider(paymentsDependency);
    payments.on('getPayment').otherwise((r) => r.fault({ code: 'METHOD_NOT_ALLOWED' }));
    payments.on('capturePayment').otherwise((r) => r.fault({ code: 'METHOD_NOT_ALLOWED' }));

    const shared = await payments.fetch(new Request(at));
    const alone = await payments.fetch(
      new Request(`${at}/capture`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ amount: 1 }),
      }),
    );

    expect(shared.headers.get('allow')).toBe('DELETE');
    expect(alone.headers.get('allow')).toBe('');
  });

  test('fault({ code: METHOD_NOT_ALLOWED }) lists a method only an Endpoint the Provider does not export takes on that path', async () => {
    const routed = { visibility: 'internal', success: { status: 204 } } as const;
    const first = defineEndpoint({
      ...routed,
      name: 'getFirst',
      method: 'GET',
      path: '/p/:x/b',
      description: 'Exported',
      input: { params: z.object({ x: z.string() }) },
    });
    const zed = defineEndpoint({
      ...routed,
      name: 'postZed',
      method: 'POST',
      path: '/p/a/z',
      description: 'Exported and listed',
    });
    const retired = defineEndpoint({
      ...routed,
      name: 'getRetired',
      method: 'GET',
      path: '/p/a/:y',
      lifecycle: 'retired',
      description: 'Retired, so not exported',
      input: { params: z.object({ y: z.string() }) },
    });
    const provider = contractPackageOf({ getFirst: first, postZed: zed }, [first, zed, retired]);
    const dependency = defineDependency({ provider, endpoints: [provider.endpoints.postZed] });
    const payments = fakeProvider(dependency);
    payments.on('postZed').otherwise((r) => r.fault({ code: 'METHOD_NOT_ALLOWED' }));

    const response = await payments.fetch(
      new Request('https://payments-service.test/p/a/z', { method: 'POST' }),
    );

    expect(response.headers.get('allow')).toBe('GET');
  });

  test('an abort while a step waits rejects fetch with the signal’s reason', async () => {
    const payments = fakeProvider(paymentsDependency);
    const waiting = Promise.withResolvers<void>();
    payments.on('getPayment').otherwise(async (builder) => {
      await waiting.promise;
      return builder.reject('NO_PAYMENT');
    });
    const controller = new AbortController();
    const reason = new Error('Gave up');

    const answering = payments.fetch(new Request(at, { signal: controller.signal }));
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

  test('a missing step is reported for the request counted without one aborted while it waited', async () => {
    const payments = fakeProvider(paymentsDependency);
    payments.on('capturePayment').once((r, { body }) => r.success({ amount: body.amount }));
    const gated = gatedBodyOf(1);
    const controller = new AbortController();
    const reason = new Error('Gave up');

    const first = capture(payments, gated.body);
    const second = capture(payments, '{"amount":2}', controller.signal).catch((e: unknown) => e);
    await settling();
    controller.abort(reason);
    gated.open();
    const third = capture(payments, '{"amount":3}');

    await first;
    expect(await second).toBe(reason);
    await expect(third).rejects.toThrow(
      'no step is left and no otherwise answers: request 2, after 1 once step',
    );
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
  return payments.fetch(
    new Request(`${at}/capture`, signal === undefined ? init : { ...init, signal }),
  );
}

/** Lets every request sent so far read what it can. */
function settling(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 5));
}
