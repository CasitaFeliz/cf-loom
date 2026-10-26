import {
  defineDependency,
  defineEndpoint,
  defineGroup,
  defineService,
  type Endpoint,
  notFound,
  openEnum,
  openEnumReader,
} from '@cf-loom/contract';
import { snapshotOf, validateRoot } from '@cf-loom/contract/internal';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { type Exportable, providedEndpointsOf } from '../test/provided.ts';
import { aRootPackage } from '../test/root-package.ts';
import { providedStandardRejections } from '../test/standard-rejections.ts';
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
  const standardRejections = providedStandardRejections();
  const name = 'payments-service';
  const provided = providedEndpointsOf({ name, standardRejections }, endpoints, snapshot);
  return {
    name,
    endpoints: provided,
    events: {},
    standardRejections,
  };
}

const paymentsDependencyPackage = contractPackageOf(readers, Object.values(declared));
const paymentsDependency = defineDependency({
  endpoints: [paymentsDependencyPackage.endpoints.getPayment],
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

type Builder = StepBuilder<typeof paymentsDependency, 'getPayment'>;

function circular(): unknown {
  const value: Record<string, unknown> = {};
  value['self'] = value;
  return value;
}
const headers = { 'x-note': 'fine' };
const body = { id: 'pay-1', amount: 5, stage: 'pending' } as const;

const committedGiven = ['no', 'yes', 'unknown', 'maybe', undefined];
const retryableGiven = [true, false, 'yes'];
const messageGiven = ['A message', 1, undefined];

/** Every Fault a test may script, a field the Caller reads or not; a message left out is the default. */
const scriptedFaults = committedGiven.flatMap((committed) =>
  retryableGiven.flatMap((retryable) =>
    messageGiven.map((message) => ({
      committed,
      retryable,
      ...(message === undefined ? {} : { message }),
    })),
  ),
);

/** Whether a Caller reads a scripted Fault as a Fault Envelope. */
function isReadableFault(fault: (typeof scriptedFaults)[number]): boolean {
  const message: unknown = 'message' in fault ? fault.message : 'Internal error';
  return (
    ['no', 'yes', 'unknown'].includes(String(fault.committed)) &&
    typeof fault.retryable === 'boolean' &&
    typeof message === 'string'
  );
}

describe('fakeProvider: a test’s mistakes', () => {
  test('a mistake passes through the client as FakeProviderError, never as an Outcome', async () => {
    const payments = fakeProvider(paymentsDependency);
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

  test('the mistake of no step left names the request and the once steps scripted', async () => {
    const payments = fakeProvider(paymentsDependency);
    payments.on('getPayment').once((r) => r.success({ headers, body }));
    const client = payments.client();
    await client.getPayment({ params });

    const error = await client.getPayment({ params }).catch((e: unknown) => e);

    expect(firstLineOf(error)).toBe(
      'payments-service: getPayment: no step is left and no otherwise answers: request 2, after 1 once step',
    );
  });

  test.each(scriptedFaults.filter((fault) => !isReadableFault(fault)))(
    'r.fault(%j) is a mistake, since no Caller would read it as a Fault',
    async (scripted) => {
      const payments = fakeProvider(paymentsDependency);
      payments.on('getPayment').otherwise((r) => r.fault(scripted as never));

      const error = await payments
        .client()
        .getPayment({ params })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(FakeProviderError);
      expect(firstLineOf(error)).toBe(
        "payments-service: getPayment: r.fault takes committed 'no', 'yes' or 'unknown', retryable a boolean and message a string",
      );
    },
  );

  test.each(scriptedFaults.filter(isReadableFault))(
    'r.fault(%j) answers a Fault the Caller reads',
    async (scripted) => {
      const payments = fakeProvider(paymentsDependency);
      payments.on('getPayment').otherwise((r) => r.fault(scripted as never));

      const outcome = await payments.client().getPayment({ params });

      expect(outcome).toMatchObject({
        kind: 'fault',
        source: 'provider',
        committed: scripted.committed,
        retryable: scripted.retryable,
      });
    },
  );

  test.each([1, null, ['x']])(
    'r.unknownRejection with the message %j is a mistake, since no Caller would read it as a Rejection',
    async (message) => {
      const payments = fakeProvider(paymentsDependency);
      payments
        .on('getPayment')
        .otherwise((r) => r.unknownRejection('CARD_EXPIRED', { message } as never));

      const error = await payments
        .client()
        .getPayment({ params })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(FakeProviderError);
      expect(firstLineOf(error)).toBe(
        'payments-service: getPayment: r.unknownRejection takes message a string',
      );
    },
  );

  test('an Endpoint never scripted is a mistake', async () => {
    const payments = fakeProvider(paymentsDependency);

    const calling = payments.client().getPayment({ params });

    await expect(calling).rejects.toThrow(
      "payments-service: getPayment: it was never scripted: on('getPayment') gives it steps",
    );
  });

  test('a Success that breaks its readers lists each Issue on its own line as the contract writes it, never the value', async () => {
    const payments = fakeProvider(paymentsDependency);
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
      expect.stringMatching(/^payments-service: getPayment: success\.body\.amount too_small: /),
      'payments-service: getPayment: success.body.stage invalid_value: A declared value, not an Unknown case',
    ]);
    expect((error as Error).message).not.toContain(secret);
  });

  test('a bare string where an Open Enum is declared is a mistake: an unknown value is { unknown }', async () => {
    const payments = fakeProvider(paymentsDependency);
    payments.on('getPayment').otherwise((r) =>
      // @ts-expect-error a value the Open Enum does not declare is written as its Unknown case
      r.success({ headers, body: { ...body, stage: 'refunded' } }),
    );

    const calling = payments.client().getPayment({ params });

    await expect(calling).rejects.toThrow(/success\.body\.stage invalid_value/);
  });

  test('a header that cannot travel as text is a mistake', async () => {
    const payments = fakeProvider(paymentsDependency);
    payments.on('getPayment').otherwise((r) => r.success({ headers: { 'x-note': 'a\nb' }, body }));

    const calling = payments.client().getPayment({ params });

    await expect(calling).rejects.toThrow(/success\.headers\.x-note invalid_format/);
  });

  test.each([
    [
      'a code the Endpoint answers',
      'NOT_FOUND',
      "NOT_FOUND is a code the Endpoint answers: r.reject('NOT_FOUND') answers it",
    ],
    [
      'the Standard invalid-input code, which every Endpoint answers',
      'INVALID_INPUT',
      "INVALID_INPUT is a code the Endpoint answers: r.reject('INVALID_INPUT') answers it",
    ],
    ['a reserved code', 'RETIRED', 'RETIRED is a reserved code, which r.fault({ code }) answers'],
    [
      'a code that is no UPPER_SNAKE_CASE',
      'card-expired',
      'card-expired is no UPPER_SNAKE_CASE, so no Contract can declare it',
    ],
  ])('r.unknownRejection with %s is a mistake', async (_name, code, message) => {
    const payments = fakeProvider(paymentsDependency);
    payments.on('getPayment').otherwise((r) => r.unknownRejection(code));

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
      const payments = fakeProvider(paymentsDependency);
      payments
        .on('getPayment')
        .otherwise((r) => r.unknownRejection('CARD_EXPIRED', { body: value }));

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
    const payments = fakeProvider(paymentsDependency);
    payments.on('getPayment').otherwise(step);

    const error = await payments
      .client()
      .getPayment({ params })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(FakeProviderError);
    expect(firstLineOf(error)).toMatch(/^payments-service: getPayment: the scripted /);
  });

  test('a body given for a code that declares none is a mistake, never dropped', async () => {
    const payments = fakeProvider(paymentsDependency);
    // @ts-expect-error NOT_FOUND declares no body
    payments.on('getPayment').otherwise((r) => r.reject('NOT_FOUND', { x: 1 }));

    const error = await payments
      .client()
      .getPayment({ params })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(FakeProviderError);
    expect((error as Error).message).toBe(
      [
        'payments-service: getPayment: the scripted NOT_FOUND breaks its readers',
        'payments-service: getPayment: body invalid_type: Expected no value',
      ].join('\n'),
    );
  });

  test('what fails while a scripted answer is sent is kept as the mistake’s cause', async () => {
    const payments = fakeProvider(paymentsDependency);
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
    const payments = fakeProvider(paymentsDependency);
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

  test('a code the Endpoint does not answer, given to r.reject, is a mistake naming r.unknownRejection', async () => {
    const payments = fakeProvider(paymentsDependency);
    // @ts-expect-error getPayment answers no PAYMENT_LOST
    payments.on('getPayment').otherwise((r) => r.reject('PAYMENT_LOST'));

    const error = await payments
      .client()
      .getPayment({ params })
      .catch((e: unknown) => e);

    expect(firstLineOf(error)).toBe(
      "payments-service: getPayment: the Endpoint answers no code PAYMENT_LOST; r.unknownRejection sends a code the Provider's Contract does not declare",
    );
  });

  test.each([200, 199, 600, 502.5])(
    'r.status(%i) is a mistake: the client would not infer a Fault',
    async (status) => {
      const payments = fakeProvider(paymentsDependency);
      payments.on('getPayment').otherwise((r) => r.status(status));

      const calling = payments.client().getPayment({ params });

      await expect(calling).rejects.toThrow(`other than the Success's, not ${status}`);
    },
  );

  test.each([
    ['a value that cannot be sent', { 'retry-after': 'a\nb' }],
    ['a name that cannot be sent', { 'bad name': '1' }],
  ])('r.status with a header holding %s is a mistake', async (_name, headers) => {
    const payments = fakeProvider(paymentsDependency);
    payments.on('getPayment').otherwise((r) => r.status(503, headers));

    const calling = payments.client().getPayment({ params });

    await expect(calling).rejects.toThrow(FakeProviderError);
    await expect(calling).rejects.toThrow('the headers given to r.status cannot be sent');
  });

  test.each([
    ['r.status given a symbol', (r: Builder) => r.status(Symbol('s') as never)],
    ['r.unknownRejection given a symbol', (r: Builder) => r.unknownRejection(Symbol('s') as never)],
  ])('%s is a mistake, never a TypeError the client takes for a Fault', async (_name, step) => {
    const payments = fakeProvider(paymentsDependency);
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
    const payments = fakeProvider(paymentsDependency);
    payments.on('getPayment').otherwise(() => ({}) as ScriptedAnswer);

    const calling = payments.client().getPayment({ params });

    await expect(calling).rejects.toThrow('a step returned no answer built with its r');
  });

  test('a step that throws is a mistake carrying what it threw, a TypeError included', async () => {
    const payments = fakeProvider(paymentsDependency);
    const thrown = new TypeError('Cannot read properties of undefined');
    payments.on('getPayment').otherwise(() => {
      throw thrown;
    });

    const calling = payments.client().getPayment({ params });

    await expect(calling).rejects.toThrow('payments-service: getPayment: a step threw');
    await expect(calling).rejects.toMatchObject({ name: 'FakeProviderError', cause: thrown });
  });

  test('a request no listed Endpoint matches is a mistake naming the request', async () => {
    const payments = fakeProvider(paymentsDependency);

    const answering = payments.fetch(new Request('https://payments-service.test/payments'));

    await expect(answering).rejects.toThrow(
      'payments-service: no Endpoint the Dependency lists is GET /payments under /',
    );
  });

  test('a path outside the base URL is a mistake', async () => {
    const payments = fakeProvider(paymentsDependency, { baseUrl: 'https://gateway.test/pay' });

    const answering = payments.fetch(new Request('https://gateway.test/payments/pay-1'));

    await expect(answering).rejects.toThrow(FakeProviderError);
  });
});
