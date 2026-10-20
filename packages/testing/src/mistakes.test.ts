import {
  type ContractPackage,
  defineContract,
  defineDependencies,
  defineEndpoint,
  defineGroup,
  type Endpoint,
  notFound,
  openEnum,
  openEnumReader,
} from '@cf-loom/contract';
import { exportedSnapshotOf, snapshotOf, validateContract } from '@cf-loom/contract/internal';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { FakeProviderError, fakeProvider, type ScriptedAnswer, type StepBuilder } from './index.ts';

/** The payments Endpoints, with a schema for their Open Enum: as declared, or as read. */
function paymentEndpointsOf<const Stage extends z.ZodType>(stage: Stage) {
  const getPayment = defineEndpoint({
    name: 'getPayment',
    method: 'GET',
    path: '/payments/:paymentId',
    visibility: 'internal',
    description: 'One payment',
    input: { params: z.object({ paymentId: z.string() }) },
    success: {
      status: 200,
      headers: z.object({ 'x-note': z.string() }),
      body: z.object({ id: z.string(), amount: z.int().positive(), stage }),
    },
    rejections: [notFound],
  });
  const listPayments = defineEndpoint({
    name: 'listPayments',
    method: 'GET',
    path: '/payments',
    visibility: 'internal',
    description: 'Every payment',
    success: { status: 200, body: z.array(z.string()) },
  });
  return { getPayment, listPayments };
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
  const standardRejections = {
    invalidInput: { code: 'INVALID_INPUT', status: 400, message: 'Invalid input' },
    notFound: { code: 'NOT_FOUND', status: 404, message: 'Not found' },
    notImplemented: { code: 'NOT_IMPLEMENTED', status: 501, message: 'Not implemented' },
  } as const;
  const name = 'payments-service';
  return { name, version: '1.0.0', endpoints, events: {}, standardRejections, exportedSnapshot };
}

const paymentsDeps = defineDependencies(contractPackageOf(readers, Object.values(declared)), {
  endpoints: [readers.getPayment],
});

const params = { paymentId: 'pay-1' };

/** An object whose one field throws when it is read. */
function throwingGetter(): object {
  return Object.defineProperty({}, 'id', {
    enumerable: true,
    get: () => {
      throw new Error('Unreadable');
    },
  });
}

/** The first line of what a call rejected with. */
function firstLineOf(error: unknown): string | undefined {
  return error instanceof Error ? error.message.split('\n')[0] : undefined;
}

type Builder = StepBuilder<typeof readers.getPayment, (typeof paymentsDeps)['standardRejections']>;

function circular(): unknown {
  const value: Record<string, unknown> = {};
  value['self'] = value;
  return value;
}
const headers = { 'x-note': 'fine' };
const body = { id: 'pay-1', amount: 5, stage: 'pending' } as const;

describe('fakeProvider: a test’s mistakes', () => {
  test('a mistake passes through the client as FakeProviderError, never as an Outcome', async () => {
    const payments = fakeProvider(paymentsDeps);
    payments.on('getPayment').once((r) => r.success({ headers, body }));
    const client = payments.client();
    await client.getPayment({ params });

    const calling = client.getPayment({ params });

    await expect(calling).rejects.toThrow(FakeProviderError);
    await expect(calling).rejects.toMatchObject({ name: 'FakeProviderError' });
    await expect(calling).rejects.toThrow(
      'payments-service: getPayment: no step is left and no otherwise answers',
    );
  });

  test('an Endpoint never scripted is a mistake', async () => {
    const payments = fakeProvider(paymentsDeps);

    const calling = payments.client().getPayment({ params });

    await expect(calling).rejects.toThrow(
      "payments-service: getPayment: it was never scripted: on('getPayment') gives it steps",
    );
  });

  test('a Success that breaks its readers lists each Issue on its own line, never the value', async () => {
    const payments = fakeProvider(paymentsDeps);
    const secret = 'secret-id-12345';
    payments
      .on('getPayment')
      .otherwise((r) =>
        r.success({ headers, body: { id: secret, amount: -1, stage: { unknown: 'settled' } } }),
      );

    const error = await payments
      .client()
      .getPayment({ params })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(FakeProviderError);
    const lines = String((error as Error).message).split('\n');
    expect(lines).toEqual([
      'payments-service: getPayment: the scripted Success breaks its readers',
      expect.stringMatching(/^ {2}success\.body at amount: too_small: /),
      '  success.body at stage: invalid_value: A declared value, not an Unknown case',
    ]);
    expect((error as Error).message).not.toContain(secret);
  });

  test('a bare string where an Open Enum is declared is a mistake: an unknown value is { unknown }', async () => {
    const payments = fakeProvider(paymentsDeps);
    payments.on('getPayment').otherwise((r) =>
      // @ts-expect-error a value the Open Enum does not declare is written as its Unknown case
      r.success({ headers, body: { ...body, stage: 'refunded' } }),
    );

    const calling = payments.client().getPayment({ params });

    await expect(calling).rejects.toThrow(/success\.body at stage: invalid_value/);
  });

  test('a header that cannot travel as text is a mistake', async () => {
    const payments = fakeProvider(paymentsDeps);
    payments.on('getPayment').otherwise((r) => r.success({ headers: { 'x-note': 'a\nb' }, body }));

    const calling = payments.client().getPayment({ params });

    await expect(calling).rejects.toThrow(/success\.headers at x-note: invalid_format/);
  });

  test.each([
    [
      'a code the Endpoint answers',
      'NOT_FOUND',
      'NOT_FOUND is a code the Endpoint answers, not one the Provider does not declare',
    ],
    ['a reserved code', 'RETIRED', 'RETIRED is a reserved code, which r.fault({ code }) answers'],
    [
      'a code that is no UPPER_SNAKE_CASE',
      'card-expired',
      'card-expired is no UPPER_SNAKE_CASE, so no Contract can declare it',
    ],
  ])('r.reject({ unknown }) with %s is a mistake', async (_name, code, message) => {
    const payments = fakeProvider(paymentsDeps);
    payments.on('getPayment').otherwise((r) => r.reject({ unknown: code }, {}));

    const error = await payments
      .client()
      .getPayment({ params })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(FakeProviderError);
    expect(firstLineOf(error)).toBe(`payments-service: getPayment: ${message}`);
  });

  test.each([
    ['a BigInt', 1n],
    ['a circular object', circular()],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['a function', () => 1],
    ['a Map', new Map([['a', 1]])],
    ['an undefined field', { a: undefined }],
    ['a getter that throws', throwingGetter()],
  ])(
    'a body that is no JSON, %s, for a code the Provider does not declare is a mistake',
    async (_name, value) => {
      const payments = fakeProvider(paymentsDeps);
      payments.on('getPayment').otherwise((r) => r.reject({ unknown: 'CARD_EXPIRED' }, value));

      const calling = payments.client().getPayment({ params });

      await expect(calling).rejects.toThrow(FakeProviderError);
      await expect(calling).rejects.toThrow('the scripted CARD_EXPIRED body is no JSON');
    },
  );

  test.each([
    [
      'a getter that throws in a Success body',
      (r: Builder) => r.success({ headers, body: throwingGetter() as typeof body }),
    ],
    [
      'a getter that throws in Success headers',
      (r: Builder) => r.success({ headers: throwingGetter() as typeof headers, body }),
    ],
    [
      'a getter that throws in a Rejection body',
      (r: Builder) => r.reject('INVALID_INPUT', throwingGetter() as never),
    ],
    ['a reserved code that is none', (r: Builder) => r.fault({ code: 'BOGUS' } as never)],
  ])('%s is a mistake, never what was thrown', async (_name, step) => {
    const payments = fakeProvider(paymentsDeps);
    payments.on('getPayment').otherwise(step);

    const error = await payments
      .client()
      .getPayment({ params })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(FakeProviderError);
    expect(firstLineOf(error)).toMatch(/^payments-service: getPayment: the scripted /);
  });

  test('what fails while a scripted answer is sent is kept as the mistake’s cause', async () => {
    const payments = fakeProvider(paymentsDeps);
    payments.on('getPayment').otherwise((r) => r.fault({ code: 'BOGUS' } as never));

    const error = await payments
      .client()
      .getPayment({ params })
      .catch((e: unknown) => e);

    expect(firstLineOf(error)).toBe(
      'payments-service: getPayment: the scripted answer cannot be sent',
    );
    expect(error).toMatchObject({ cause: expect.any(TypeError) });
  });

  test('a step returning what cannot be checked for an answer is a mistake', async () => {
    const payments = fakeProvider(paymentsDeps);
    const trap = new Proxy(
      {},
      {
        has: () => {
          throw new Error('No');
        },
      },
    );
    payments.on('getPayment').otherwise(() => trap as ScriptedAnswer);

    const calling = payments.client().getPayment({ params });

    await expect(calling).rejects.toThrow(FakeProviderError);
  });

  test('a code the Endpoint does not answer, given as declared, is a mistake', async () => {
    const payments = fakeProvider(paymentsDeps);
    // @ts-expect-error getPayment answers no PAYMENT_LOST
    payments.on('getPayment').otherwise((r) => r.reject('PAYMENT_LOST'));

    const calling = payments.client().getPayment({ params });

    await expect(calling).rejects.toThrow('the Endpoint answers no code PAYMENT_LOST');
  });

  test.each([200, 199, 600, 502.5])(
    'r.status(%i) is a mistake: the client would not infer a Fault',
    async (status) => {
      const payments = fakeProvider(paymentsDeps);
      payments.on('getPayment').otherwise((r) => r.status(status));

      const calling = payments.client().getPayment({ params });

      await expect(calling).rejects.toThrow(`other than the Success's, not ${status}`);
    },
  );

  test.each([
    ['a value that cannot be sent', { 'retry-after': 'a\nb' }],
    ['a name that cannot be sent', { 'bad name': '1' }],
  ])('r.status with a header holding %s is a mistake', async (_name, headers) => {
    const payments = fakeProvider(paymentsDeps);
    payments.on('getPayment').otherwise((r) => r.status(503, headers));

    const calling = payments.client().getPayment({ params });

    await expect(calling).rejects.toThrow(FakeProviderError);
    await expect(calling).rejects.toThrow('the headers given to r.status cannot be sent');
  });

  test.each([
    ['r.status given a symbol', (r: Builder) => r.status(Symbol('s') as never)],
    [
      'r.reject({ unknown }) given a symbol',
      (r: Builder) => r.reject({ unknown: Symbol('s') as never }, null),
    ],
  ])('%s is a mistake, never a TypeError the client takes for a Fault', async (_name, step) => {
    const payments = fakeProvider(paymentsDeps);
    payments.on('getPayment').otherwise(step);

    const error = await payments
      .client()
      .getPayment({ params })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(FakeProviderError);
    expect(firstLineOf(error)).toBe(
      'payments-service: getPayment: the scripted answer cannot be sent',
    );
  });

  test('a step that returns no answer built with its r is a mistake', async () => {
    const payments = fakeProvider(paymentsDeps);
    payments.on('getPayment').otherwise(() => ({}) as ScriptedAnswer);

    const calling = payments.client().getPayment({ params });

    await expect(calling).rejects.toThrow('a step returned no answer built with its r');
  });

  test('a step that throws is a mistake carrying what it threw, a TypeError included', async () => {
    const payments = fakeProvider(paymentsDeps);
    const thrown = new TypeError('Cannot read properties of undefined');
    payments.on('getPayment').otherwise(() => {
      throw thrown;
    });

    const calling = payments.client().getPayment({ params });

    await expect(calling).rejects.toThrow('payments-service: getPayment: a step threw');
    await expect(calling).rejects.toMatchObject({ name: 'FakeProviderError', cause: thrown });
  });

  test('an Endpoint the Dependency does not list is a mistake', async () => {
    const payments = fakeProvider(paymentsDeps);

    const answering = payments.fetch('https://payments-service.test/payments', {});

    await expect(answering).rejects.toThrow('the Dependency does not list GET /payments');
  });

  test('a path outside the base URL is a mistake', async () => {
    const payments = fakeProvider(paymentsDeps, { baseUrl: 'https://gateway.test/pay' });

    const answering = payments.fetch('https://gateway.test/payments/pay-1', {});

    await expect(answering).rejects.toThrow(FakeProviderError);
  });
});
