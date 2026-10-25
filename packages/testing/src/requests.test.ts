import {
  type ContractPackage,
  defineContract,
  defineDependency,
  defineEndpoint,
  defineGroup,
  defineGuard,
  type Endpoint,
  type ExportedSnapshot,
} from '@cf-loom/contract';
import { exportedSnapshotOf, snapshotOf, validateContract } from '@cf-loom/contract/internal';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { providedStandardRejections } from '../test/standard-rejections.ts';
import { FakeProviderError, fakeProvider } from './index.ts';

const apiKey = defineGuard({
  name: 'apiKey',
  description: 'A key per Caller',
  demands: { headers: z.object({ 'x-api-key': z.string() }) },
});

const getPayment = defineEndpoint({
  name: 'getPayment',
  method: 'GET',
  path: '/payments/:paymentId',
  visibility: 'internal',
  description: 'One payment',
  guards: [apiKey],
  input: {
    params: z.object({ paymentId: z.string().min(3) }),
    query: z.object({ expand: z.array(z.string()).optional() }),
    headers: z.object({ 'x-api-key': z.string() }),
  },
  success: { status: 200, body: z.object({ id: z.string() }) },
});

const capturePayment = defineEndpoint({
  name: 'capturePayment',
  method: 'POST',
  path: '/payments/:paymentId/capture',
  visibility: 'internal',
  description: 'Captures a payment',
  input: {
    params: z.object({ paymentId: z.string().min(3) }),
    body: z.object({ amount: z.int().positive() }),
  },
  success: { status: 200, body: z.object({ id: z.string(), amount: z.int() }) },
});

const getSummary = defineEndpoint({
  name: 'getSummary',
  method: 'GET',
  path: '/payments/summary',
  visibility: 'internal',
  description: 'Every payment summed up',
  success: { status: 200, body: z.object({ total: z.int() }) },
});

/** An Endpoint whose literal path would beat `getPayment`'s param, of the Visibility and lifecycle given. */
function latestPayment(fields: {
  readonly visibility: 'private' | 'internal';
  readonly lifecycle: 'active' | 'retired';
}) {
  return defineEndpoint({
    name: 'getLatestPayment',
    method: 'GET',
    path: '/payments/latest',
    description: 'The latest payment',
    ...fields,
    success: { status: 200, body: z.object({ id: z.string() }) },
  });
}

/** The Provider's Contract Package, as `cf-loom package` writes it from its declarations. */
function contractPackageOf<const Endpoints extends ContractPackage['endpoints']>(
  endpoints: Endpoints,
  declared: readonly Endpoint[] = Object.values(endpoints),
) {
  const listed = declared as unknown as [Endpoint];
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
    invalidInput: { code: 'BAD_REQUEST', status: 422, message: 'The request is invalid' },
  });
  const name = 'payments-service';
  return { name, version: '1.0.0', endpoints, events: {}, standardRejections, exportedSnapshot };
}

const payments = contractPackageOf({ getPayment, capturePayment, getSummary });

/** The Provider's Contract Package as another cf-loom wrote it: a `format` of its own and no entry a listed Endpoint could find. */
function inFormat(contractPackage: typeof payments, format: unknown): typeof payments {
  const exportedSnapshot = { ...contractPackage.exportedSnapshot, format, endpoints: {} };
  return { ...contractPackage, exportedSnapshot: exportedSnapshot as ExportedSnapshot };
}

const paymentsDependency = defineDependency({
  provider: payments,
  endpoints: [getPayment, capturePayment],
});

const at = 'https://payments-service.test';

/** A fake whose every listed Endpoint counts the steps it took. */
function countingFake(options: { readonly baseUrl?: string } = {}) {
  const fake = fakeProvider(paymentsDependency, options);
  const taken = { getPayment: 0, capturePayment: 0 };
  fake.on('getPayment').otherwise((builder, { params }) => {
    taken.getPayment += 1;
    return builder.success({ id: params.paymentId });
  });
  fake.on('capturePayment').otherwise((builder, { params, body }) => {
    taken.capturePayment += 1;
    return builder.success({ id: params.paymentId, amount: body.amount });
  });
  return { fake, taken };
}

function captureInit(body: string, contentType = 'application/json'): RequestInit {
  return { method: 'POST', headers: { 'content-type': contentType }, body };
}

describe('fakeProvider: requests', () => {
  test('a param that breaks its schema answers the invalid-input Rejection, takes no step and is recorded', async () => {
    const { fake, taken } = countingFake();

    const response = await fake.fetch(
      new Request(`${at}/payments/ab`, { headers: { 'x-api-key': 'k' } }),
    );

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      rejection: {
        code: 'BAD_REQUEST',
        message: 'The request is invalid',
        body: {
          issues: [
            { in: 'params', path: ['paymentId'], code: 'too_small', message: expect.any(String) },
          ],
        },
      },
    });
    expect(taken.getPayment).toBe(0);
    expect(fake.calls('getPayment')).toEqual([
      {
        kind: 'invalid',
        issues: [
          { in: 'params', path: ['paymentId'], code: 'too_small', message: expect.any(String) },
        ],
      },
    ]);
  });

  test('a missing demanded header answers alone, before the Input is read', async () => {
    const { fake } = countingFake();

    const response = await fake.fetch(new Request(`${at}/payments/ab`));

    expect(await response.json()).toMatchObject({
      rejection: { body: { issues: [{ in: 'headers', path: ['x-api-key'], code: 'required' }] } },
    });
  });

  test.each([
    [
      'a wrong content type',
      captureInit('{"amount":1}', 'text/plain'),
      'The content type is not application/json',
    ],
    ['a body that is no JSON', captureInit('{'), 'The body is not JSON'],
  ])('%s answers malformed alone', async (_name, init, message) => {
    const { fake, taken } = countingFake();

    const response = await fake.fetch(new Request(`${at}/payments/ab/capture`, init));

    expect(await response.json()).toMatchObject({
      rejection: { body: { issues: [{ in: 'body', path: [], code: 'malformed', message }] } },
    });
    expect(taken.capturePayment).toBe(0);
  });

  test('a valid request reaches its step with its Input parsed, unknown keys stripped', async () => {
    const fake = fakeProvider(paymentsDependency);
    const inputs: unknown[] = [];
    fake.on('capturePayment').otherwise((builder, input) => {
      inputs.push(input);
      return builder.success({ id: input.params.paymentId, amount: input.body.amount });
    });

    await fake.fetch(
      new Request(`${at}/payments/pay-1/capture`, captureInit('{"amount":5,"note":"x"}')),
    );

    expect(inputs).toEqual([{ params: { paymentId: 'pay-1' }, body: { amount: 5 } }]);
    expect(fake.calls('capturePayment')).toEqual([{ kind: 'valid', input: inputs[0] }]);
  });

  test('text parts are converted by their nodes, a repeated query key as a list', async () => {
    const fake = fakeProvider(paymentsDependency);
    fake.on('getPayment').otherwise((r, { params }) => r.success({ id: params.paymentId }));

    await fake.fetch(
      new Request(`${at}/payments/pay-1?expand=a&expand=b`, { headers: { 'x-api-key': 'k' } }),
    );

    expect(fake.calls('getPayment')).toEqual([
      {
        kind: 'valid',
        input: {
          params: { paymentId: 'pay-1' },
          query: { expand: ['a', 'b'] },
          headers: { 'x-api-key': 'k' },
        },
      },
    ]);
  });

  test('a Request is answered whole, with nothing given beside it', async () => {
    const { fake } = countingFake();
    const request = new Request(`${at}/payments/pay-1`, { headers: { 'x-api-key': 'k' } });

    const response = await fake.fetch(request);

    expect(await response.json()).toEqual({ id: 'pay-1' });
  });

  test('a request to another origin still reaches the fake', async () => {
    const { fake, taken } = countingFake();

    const response = await fake.fetch(
      new Request('http://elsewhere.example/payments/pay-1', {
        headers: { 'x-api-key': 'k' },
      }),
    );

    expect(response.status).toBe(200);
    expect(taken.getPayment).toBe(1);
  });

  test('a baseUrl’s path is a prefix its client calls under, and a path outside it is a mistake', async () => {
    const { fake } = countingFake({ baseUrl: 'https://gateway.test/payments-api/' });

    const outcome = await fake.client({ headers: { 'x-api-key': 'k' } }).getPayment({
      params: { paymentId: 'pay-1' },
    });
    const outside = fake.fetch(new Request('https://gateway.test/payments/pay-1'));

    expect(outcome).toEqual({ kind: 'success', status: 200, body: { id: 'pay-1' } });
    await expect(outside).rejects.toThrow(
      "payments-service: the path /payments/pay-1 is outside the base URL's path /payments-api/",
    );
  });

  test('an unlisted Endpoint whose literal beats a listed param is a mistake, not that param', async () => {
    const { fake, taken } = countingFake();

    const answering = fake.fetch(
      new Request(`${at}/payments/summary`, { headers: { 'x-api-key': 'k' } }),
    );

    await expect(answering).rejects.toThrow(FakeProviderError);
    await expect(answering).rejects.toThrow('does not list GET /payments/summary');
    expect(taken.getPayment).toBe(0);
  });

  test.each([
    ['Private', latestPayment({ visibility: 'private', lifecycle: 'active' })],
    ['Retired', latestPayment({ visibility: 'internal', lifecycle: 'retired' })],
  ])(
    'a %s Endpoint whose literal would beat a listed param never takes a request: the param does',
    async (_, latest) => {
      const declared = [getPayment, capturePayment, getSummary, latest];
      const provider = contractPackageOf({ getPayment, capturePayment, getSummary }, declared);
      const dependency = defineDependency({ provider: provider, endpoints: [getPayment] });
      const fake = fakeProvider(dependency);
      fake
        .on('getPayment')
        .otherwise((builder, { params }) => builder.success({ id: params.paymentId }));

      const response = await fake.fetch(
        new Request(`${at}/payments/latest`, { headers: { 'x-api-key': 'k' } }),
      );

      expect(await response.json()).toEqual({ id: 'latest' });
    },
  );

  test('a baseUrl with a query is a bug, refused when the fake is created', () => {
    const create = () =>
      fakeProvider(paymentsDependency, { baseUrl: 'https://gateway.test/api?x=1' });

    expect(create).toThrow('has a query or a fragment');
  });

  test('a baseUrl with a username or a password is a bug, refused when the fake is created', () => {
    const create = () =>
      fakeProvider(paymentsDependency, { baseUrl: 'https://ann:secret@gateway.test/' });

    expect(create).toThrow('has a username or a password');
  });

  test('a Contract Package in a format the fake does not read is a bug, refused when it is created', () => {
    const newer = defineDependency({ provider: inFormat(payments, 2), endpoints: [getPayment] });

    const create = () => fakeProvider(newer);

    expect(create).toThrow(
      "payments-service's exported Snapshot is in format 2, newer than this cf-loom reads: upgrade the @cf-loom packages",
    );
  });

  test('a path that only begins like the base URL’s path lies outside it', async () => {
    const { fake } = countingFake({ baseUrl: 'https://gateway.test/api' });

    const answering = fake.fetch(new Request('https://gateway.test/apix/payments/pay-1'));

    await expect(answering).rejects.toThrow(
      "the path /apix/payments/pay-1 is outside the base URL's path /api/",
    );
  });

  test('a path that begins with an empty segment is matched as a path, never as a host', async () => {
    const { fake, taken } = countingFake();

    const answering = fake.fetch(
      new Request(`${at}//elsewhere/payments/pay-1`, {
        headers: { 'x-api-key': 'k' },
      }),
    );

    await expect(answering).rejects.toThrow(FakeProviderError);
    expect(taken.getPayment).toBe(0);
  });

  test('a signal already aborted rejects with its reason, recording no call and taking no step', async () => {
    const { fake, taken } = countingFake();
    const reason = new Error('Gave up');

    const answering = fake.fetch(
      new Request(`${at}/payments/pay-1`, {
        headers: { 'x-api-key': 'k' },
        signal: AbortSignal.abort(reason),
      }),
    );

    await expect(answering).rejects.toBe(reason);
    expect(fake.calls('getPayment')).toEqual([]);
    expect(taken.getPayment).toBe(0);
  });

  test('calls are a frozen copy', async () => {
    const { fake } = countingFake();
    await fake.fetch(new Request(`${at}/payments/pay-1`, { headers: { 'x-api-key': 'k' } }));

    const calls = fake.calls('getPayment');

    expect(Object.isFrozen(calls)).toBe(true);
    expect(fake.calls('getPayment')).not.toBe(calls);
  });

  test('a path no exported Endpoint matches is a mistake naming the path and the base URL', async () => {
    const { fake } = countingFake({ baseUrl: 'https://gateway.test/payments-api' });

    const answering = fake.fetch(new Request('https://gateway.test/payments-api/refunds/r-1'));

    await expect(answering).rejects.toThrow(
      'payments-service: no Endpoint it exports is GET /refunds/r-1 under /payments-api/',
    );
  });

  test('a method the exported path does not take is a mistake naming the path’s methods', async () => {
    const { fake } = countingFake({ baseUrl: 'https://gateway.test/payments-api' });

    const answering = fake.fetch(
      new Request('https://gateway.test/payments-api/payments/pay-1', {
        method: 'DELETE',
      }),
    );

    await expect(answering).rejects.toThrow(
      'payments-service: no Endpoint it exports is DELETE /payments/pay-1 under /payments-api/; that path takes GET',
    );
  });
});
