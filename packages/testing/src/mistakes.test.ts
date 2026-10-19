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
} from '@casitafeliz/loom-contract';
import { snapshotOf, validateContract } from '@casitafeliz/loom-contract/internal';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { FakeProviderError, fakeProvider, type ScriptedAnswer } from './index.ts';

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
  const { format, defs, endpoints: entries, guards, codes } = snapshot;
  const exportedSnapshot = { format, defs, endpoints: entries, guards, codes };
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

  test('an Unknown code the Endpoint answers is a mistake', async () => {
    const payments = fakeProvider(paymentsDeps);
    payments.on('getPayment').otherwise((r) => r.reject({ unknown: 'NOT_FOUND' }, {}));

    const calling = payments.client().getPayment({ params });

    await expect(calling).rejects.toThrow('NOT_FOUND is a code the Endpoint answers');
  });

  test('a code the Endpoint does not answer, given as declared, is a mistake', async () => {
    const payments = fakeProvider(paymentsDeps);
    // @ts-expect-error getPayment answers no PAYMENT_LOST
    payments.on('getPayment').otherwise((r) => r.reject('PAYMENT_LOST'));

    const calling = payments.client().getPayment({ params });

    await expect(calling).rejects.toThrow('the Endpoint answers no code PAYMENT_LOST');
  });

  test.each([200, 199, 600])(
    'r.status(%i) is a mistake: the client would not infer a Fault',
    async (status) => {
      const payments = fakeProvider(paymentsDeps);
      payments.on('getPayment').otherwise((r) => r.status(status));

      const calling = payments.client().getPayment({ params });

      await expect(calling).rejects.toThrow(`other than the Success's, not ${status}`);
    },
  );

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
