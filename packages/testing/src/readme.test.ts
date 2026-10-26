import type { Client } from '@cf-loom/client';
import {
  defineDependency,
  defineEndpoint,
  defineGroup,
  defineGuard,
  defineService,
  type Endpoint,
  notFound,
} from '@cf-loom/contract';
import { exportedSnapshotOf, snapshotOf, validateRoot } from '@cf-loom/contract/internal';
import { type CheckedOutcome, handle, success, type WithResources } from '@cf-loom/handlers';
import { expect, test } from 'vitest';
import { z } from 'zod';
import { type Exportable, providedEndpointsOf } from '../test/provided.ts';
import { aRootPackage } from '../test/root-package.ts';
import { providedStandardRejections } from '../test/standard-rejections.ts';
import { fakeProvider } from './index.ts';

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
    params: z.object({ paymentId: z.string() }),
    headers: z.object({ 'x-api-key': z.string() }),
  },
  success: { status: 200, body: z.object({ id: z.string(), amount: z.int().positive() }) },
  rejections: [notFound],
});

/** The Provider's Contract Package, as `cf-loom package` writes it from its declarations. */
function contractPackageOf<const Endpoints extends Readonly<Record<string, Exportable>>>(
  endpoints: Endpoints,
) {
  const listed = Object.values(endpoints) as unknown as [Endpoint];
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
  const standardRejections = providedStandardRejections();
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

/** The Provider's Contract Package, as a Consumer imports it. */
const payments = contractPackageOf({ getPayment });

const paymentsDependency = defineDependency({
  provider: payments,
  endpoints: [payments.endpoints.getPayment],
});

const settlePayment = defineEndpoint({
  name: 'settlePayment',
  method: 'POST',
  path: '/payments/:paymentId/settle',
  visibility: 'internal',
  description: 'Settles a payment once the Provider has it',
  input: { params: z.object({ paymentId: z.string() }) },
  success: { status: 200, body: z.object({ outcomes: z.array(z.string()) }) },
});

type Resources = { readonly payments: Client<typeof paymentsDependency, 'x-api-key'> };
type Needs<Key extends keyof Resources> = WithResources<Pick<Resources, Key>>;

/** The Handler under test: it asks for a payment until the Provider answers it, and answers each Outcome it received, as JSON. */
const settlePaymentHandler = handle(
  settlePayment,
  async ({ params }, _call, { resources: { payments } }: Needs<'payments'>) => {
    const outcomes: string[] = [];
    for (let attempt = 0; attempt < 7; attempt += 1) {
      const outcome = await payments.getPayment({ params: { paymentId: params.paymentId } });
      outcomes.push(JSON.stringify(outcome));
      if (outcome.kind === 'success') {
        break;
      }
    }
    return success({ outcomes });
  },
);

/** The Outcomes the Handler under test received, in order. */
function received(answer: CheckedOutcome<typeof settlePayment>): unknown[] {
  if (answer.kind !== 'success') {
    throw new Error(`The Handler answered ${answer.kind}`);
  }
  return answer.body.outcomes.map((outcome) => JSON.parse(outcome));
}

test('the README’s fakeProvider example runs: a Handler called directly with the fake’s client receives each scripted Outcome', async () => {
  const payments = fakeProvider(paymentsDependency);
  payments
    .on('getPayment')
    .once((r) => r.reject('NOT_FOUND'))
    .once((r) => r.unknownRejection('CARD_EXPIRED'))
    .once((r) => r.fault({ committed: 'no', retryable: true }))
    .once((r) => r.noConnection())
    .once((r) => r.reset())
    .once((r) => r.status(502))
    .otherwise((r, { params }) => r.success({ id: params.paymentId, amount: 1200 }));

  const resources = { payments: payments.client({ headers: { 'x-api-key': 'k' } }) };
  const answer = await settlePaymentHandler({ params: { paymentId: 'pay-1' } }, {}, { resources });
  const calls = payments.calls('getPayment');

  expect(answer).toMatchObject({ kind: 'success', status: 200 });
  expect(received(answer)).toMatchObject([
    { kind: 'rejection', source: 'provider', code: 'NOT_FOUND', status: 404, message: 'Not found' },
    {
      kind: 'unknown-rejection',
      source: 'provider',
      code: 'CARD_EXPIRED',
      status: 422,
      message: 'CARD_EXPIRED',
    },
    {
      kind: 'fault',
      source: 'provider',
      status: 503,
      committed: 'no',
      retryable: true,
      message: 'Internal error',
    },
    {
      kind: 'fault',
      source: 'no-connection',
      committed: 'no',
      retryable: true,
      message: 'No connection to the Provider',
    },
    {
      kind: 'fault',
      source: 'connection-lost',
      committed: 'unknown',
      retryable: true,
      message: 'The connection failed',
    },
    {
      kind: 'fault',
      source: 'status',
      status: 502,
      committed: 'unknown',
      retryable: false,
      message: 'The Provider answered 502',
    },
    { kind: 'success', status: 200, body: { id: 'pay-1', amount: 1200 } },
  ]);
  const input = { params: { paymentId: 'pay-1' }, headers: { 'x-api-key': 'k' } };
  expect(calls).toEqual(Array.from({ length: 7 }, () => input));
});

test('the README’s verify example runs: a fake all of whose steps were taken verifies, and one left a step does not', async () => {
  const payments = fakeProvider(paymentsDependency);
  payments
    .on('getPayment')
    .once((r, { params }) => r.success({ id: params.paymentId, amount: 1200 }));
  const resources = { payments: payments.client({ headers: { 'x-api-key': 'k' } }) };
  const unsettled = fakeProvider(paymentsDependency);
  unsettled.on('getPayment').once((r) => r.fault({ committed: 'no', retryable: true }));

  await settlePaymentHandler({ params: { paymentId: 'pay-1' } }, {}, { resources });

  expect(() => payments.verify()).not.toThrow();
  expect(() => unsettled.verify()).toThrow('payments-service: getPayment: 1 once step left unused');
});

test('the entry exports fakeProvider and FakeProviderError alone, as the README lists them', async () => {
  const entry = await import('./index.ts');

  const exported = Object.keys(entry).sort();

  expect(exported).toEqual(['FakeProviderError', 'fakeProvider']);
});
