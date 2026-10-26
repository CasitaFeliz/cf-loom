import {
  defineContract,
  defineDependency,
  defineEndpoint,
  defineGroup,
  type Endpoint,
  notFound,
  type ProvidedStandardRejections,
} from '@cf-loom/contract';
import { exportedSnapshotOf, snapshotOf, validateContract } from '@cf-loom/contract/internal';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { type Exportable, providedEndpointsOf } from '../test/provided.ts';
import { aRootPackage } from '../test/root-package.ts';
import { providedStandardRejections } from '../test/standard-rejections.ts';
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
  const Endpoints extends Readonly<Record<string, Exportable>>,
  const Standards extends ProvidedStandardRejections,
>(endpoints: Endpoints, standardRejections: Standards, declared = Object.values(endpoints)) {
  const listed = declared as unknown as [Endpoint];
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
  const name = 'payments-service';
  const provided = providedEndpointsOf(name, endpoints);
  return {
    name,
    version: '5.1.0',
    endpoints: provided,
    events: {},
    standardRejections,
    exportedSnapshot,
  };
}

const payments = contractPackageOf({ getPayment }, providedStandardRejections());

const paymentsDependency = defineDependency({
  provider: payments,
  endpoints: [payments.endpoints.getPayment],
});

const paymentId = '6f1c2a3e-8a4b-4c1d-9e2f-0a1b2c3d4e5f';
const settings = { paymentsKey: 'k-1' };

/** The README's example, against a `fetch` that answers what the test gives. */
async function readmeExample(answer: () => Response) {
  const retry = () => 'retried';
  const baseUrl = 'https://payments.test';
  const fetch = async () => answer();

  const payments = client(paymentsDependency, {
    baseUrl,
    headers: { 'x-api-key': settings.paymentsKey }, // a string
    fetch,
  });
  const outcome = await payments.getPayment({ params: { paymentId } });

  switch (outcome.kind) {
    case 'success':
      return outcome.body.amount;
    case 'rejection':
      if (outcome.code === 'NOT_FOUND') return null; // getPayment lists notFound
      throw new Error(outcome.message);
    case 'unknown-rejection':
      throw new Error(`${outcome.code}: ${outcome.message}`);
    case 'fault':
      if (outcome.committed === 'no' && outcome.retryable) return retry();
      throw new Error(`payments-service failed: ${outcome.source}`);
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

  test('under the README’s retry rule a cancelled call is never retried', async () => {
    const payments = client(paymentsDependency, {
      baseUrl: 'https://payments.test',
      headers: { 'x-api-key': settings.paymentsKey },
      fetch: async () => Response.json({ amount: 120 }),
    });
    const cancelled = AbortSignal.abort();
    let attempts = 0;

    for (let attempt = 0; attempt < 50; attempt += 1) {
      attempts += 1;
      const outcome = await payments.getPayment({ params: { paymentId } }, { signal: cancelled });
      if (outcome.kind !== 'fault' || outcome.committed !== 'no' || !outcome.retryable) {
        break;
      }
    }

    expect(attempts).toBe(1);
  });

  test('a fetch wrapper building another Request sends the call with a browser’s credentials', async () => {
    const sent: Request[] = [];
    const answering = async (request: Request) => {
      sent.push(request);
      return Response.json({ amount: 120 });
    };
    const credentialed: Client<typeof paymentsDependency, 'x-api-key'> = client(
      paymentsDependency,
      {
        baseUrl: 'https://payments.test',
        headers: { 'x-api-key': 'k' },
        fetch: (request) => answering(new Request(request, { credentials: 'include' })),
      },
    );

    await credentialed.getPayment({ params: { paymentId } });

    expect(sent[0]?.credentials).toBe('include');
    expect(sent[0]?.headers.get('x-api-key')).toBe('k');
  });

  test('a bare TypeError, as a browser’s fetch throws it, is connection-failed and not retryable until inferFault relaxes it', async () => {
    const blocked = async (): Promise<Response> => {
      throw new TypeError('Failed to fetch');
    };
    const options = { baseUrl: 'https://payments.test', headers: { 'x-api-key': 'k' } };
    const asIs = client(paymentsDependency, { ...options, fetch: blocked });
    const relaxed = client(paymentsDependency, {
      ...options,
      fetch: blocked,
      inferFault: (happened) =>
        happened.kind === 'connection-failed'
          ? { committed: 'unknown', retryable: true }
          : undefined,
    });

    const outcomes = [
      await asIs.getPayment({ params: { paymentId } }),
      await relaxed.getPayment({ params: { paymentId } }),
    ];

    expect(outcomes).toMatchObject([
      { kind: 'fault', source: 'connection-failed', committed: 'unknown', retryable: false },
      { kind: 'fault', source: 'connection-failed', committed: 'unknown', retryable: true },
    ]);
  });
});
