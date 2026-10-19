import { client } from '@casitafeliz/loom-client';
import {
  type ContractPackage,
  defineContract,
  defineDependencies,
  defineEndpoint,
  defineGroup,
  type Endpoint,
} from '@casitafeliz/loom-contract';
import { snapshotOf, validateContract } from '@casitafeliz/loom-contract/internal';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { fakeProvider } from './index.ts';

const getPayment = defineEndpoint({
  name: 'getPayment',
  method: 'GET',
  path: '/payments/:paymentId',
  visibility: 'internal',
  description: 'One payment',
  input: { params: z.object({ paymentId: z.string() }) },
  success: { status: 200, body: z.object({ id: z.string() }) },
});

/** The Provider's Contract Package, as `cf-loom package` writes it from its declarations. */
function contractPackageOf<const Endpoints extends ContractPackage['endpoints']>(
  endpoints: Endpoints,
) {
  const listed = Object.values(endpoints) as unknown as [Endpoint];
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

const paymentsDeps = defineDependencies(contractPackageOf({ getPayment }), {
  endpoints: [getPayment],
});

const params = { paymentId: 'pay-1' };

describe('fakeProvider: what the client infers its Fault from', () => {
  test('noConnection is a refused connection: committed no, retryable', async () => {
    const payments = fakeProvider(paymentsDeps);
    payments.on('getPayment').otherwise((r) => r.noConnection());

    const outcome = await payments.client().getPayment({ params });

    expect(outcome).toMatchObject({
      kind: 'fault',
      committed: 'no',
      retryable: true,
      message: 'No connection to the Provider',
      cause: { name: 'TypeError', cause: { code: 'ECONNREFUSED' } },
    });
  });

  test('reset is a connection reset after sending: committed unknown, retryable', async () => {
    const payments = fakeProvider(paymentsDeps);
    payments.on('getPayment').otherwise((r) => r.reset());

    const outcome = await payments.client().getPayment({ params });

    expect(outcome).toMatchObject({
      kind: 'fault',
      committed: 'unknown',
      retryable: true,
      message: 'The connection failed',
      cause: { name: 'TypeError', cause: { code: 'ECONNRESET' } },
    });
  });

  test.each([
    [502, {}, { committed: 'unknown', retryable: false }],
    [503, { 'retry-after': '30' }, { committed: 'unknown', retryable: true, retryAfter: '30' }],
    [429, {}, { committed: 'no', retryable: true }],
  ] as const)('status(%i) is inferred from the status alone', async (status, headers, fault) => {
    const payments = fakeProvider(paymentsDeps);
    payments.on('getPayment').otherwise((r) => r.status(status, headers));

    const outcome = await payments.client().getPayment({ params });

    expect(outcome).toEqual({
      kind: 'fault',
      message: `The Provider answered ${status}`,
      ...fault,
    });
  });

  test('a client the code builds itself over payments.fetch reaches the fake', async () => {
    const payments = fakeProvider(paymentsDeps);
    payments.on('getPayment').otherwise((r, input) => r.success({ id: input.params.paymentId }));
    const own = client(paymentsDeps, {
      baseUrl: 'https://payments.internal.example',
      fetch: payments.fetch,
    });

    const outcome = await own.getPayment({ params });

    expect(outcome).toEqual({ kind: 'success', value: { id: 'pay-1' }, headers: {} });
  });
});
