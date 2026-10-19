import {
  type ContractPackage,
  defineContract,
  defineDependencies,
  defineEndpoint,
  defineGroup,
  type Endpoint,
  notFound,
  type StandardRejections,
} from '@casitafeliz/loom-contract';
import { snapshotOf, validateContract } from '@casitafeliz/loom-contract/internal';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { type Client, client } from './index.ts';

const getPayment = defineEndpoint({
  name: 'getPayment',
  method: 'GET',
  path: '/payments/:paymentId',
  visibility: 'public',
  description: 'One payment by id',
  input: {
    params: z.object({ paymentId: z.uuid() }),
    headers: z.object({ 'x-api-key': z.string() }),
  },
  success: { status: 200, body: z.object({ amount: z.int() }) },
  rejections: [notFound],
});

/**
 * The Provider's Contract Package as `cf-loom package` writes it: its Endpoints, its resolved
 * Standard Rejections, and the Snapshot its declarations give, cut to what it exports.
 */
function contractPackageOf<
  const Endpoints extends ContractPackage['endpoints'],
  const Standards extends StandardRejections,
>(endpoints: Endpoints, standardRejections: Standards, declared = Object.values(endpoints)) {
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
  const { format, defs, guards, codes } = snapshot;
  const exportedSnapshot = { format, defs, endpoints: snapshot.endpoints, guards, codes };
  const name = 'payments-service';
  return { name, version: '5.1.0', endpoints, events: {}, standardRejections, exportedSnapshot };
}

const payments = contractPackageOf({ getPayment }, {
  invalidInput: { code: 'INVALID_INPUT', status: 400, message: 'Invalid input' },
  notFound: { code: 'NOT_FOUND', status: 404, message: 'Not found' },
  notImplemented: { code: 'NOT_IMPLEMENTED', status: 501, message: 'Not implemented' },
} as const);

const paymentsDeps = defineDependencies(payments, { endpoints: [payments.endpoints.getPayment] });

const paymentId = '6f1c2a3e-8a4b-4c1d-9e2f-0a1b2c3d4e5f';
const settings = { paymentsKey: 'k-1' };

/** The README's example, against a `fetch` that answers what the test gives. */
async function readmeExample(answer: () => Response) {
  const retry = () => 'retried';
  const baseUrl = 'https://payments.test';
  const fetch = async () => answer();

  const payments = client(paymentsDeps, {
    baseUrl,
    headers: { 'x-api-key': settings.paymentsKey }, // a string
    fetch,
  });
  const outcome = await payments.getPayment({ params: { paymentId } });

  switch (outcome.kind) {
    case 'success':
      return outcome.value.amount;
    case 'rejection':
      if (outcome.known && outcome.code === 'NOT_FOUND') return null; // getPayment lists notFound
      throw new Error(outcome.message);
    case 'fault':
      if (outcome.committed === 'no' && outcome.retryable) return retry();
      throw new Error('payments-service failed');
  }
}

describe('the README', () => {
  test('Consuming a Contract runs, through a Success, a known Rejection and a Fault', async () => {
    const results = [
      await readmeExample(() => Response.json({ amount: 120 })),
      await readmeExample(() =>
        Response.json({ rejection: { code: 'NOT_FOUND', message: 'Not found' } }, { status: 404 }),
      ),
      await readmeExample(() => new Response(null, { status: 429 })),
    ];

    expect(results).toEqual([120, null, 'retried']);
  });

  test('a fetch wrapper adding a browser’s credentials type-checks, and Client names the headers', () => {
    const credentialed: Client<typeof paymentsDeps, 'x-api-key'> = client(paymentsDeps, {
      baseUrl: 'https://payments.test',
      headers: { 'x-api-key': 'k' },
      fetch: (url, init) => fetch(url, { ...init, credentials: 'include' }),
    });

    expect(Object.keys(credentialed)).toEqual(['getPayment']);
  });
});
