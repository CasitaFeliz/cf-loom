import type { Client, ReceivedOutcome } from '@casitafeliz/loom-client';
import {
  type ContractPackage,
  defineContract,
  defineDependencies,
  defineEndpoint,
  defineGroup,
  defineGuard,
  type Endpoint,
  notFound,
} from '@casitafeliz/loom-contract';
import { snapshotOf, validateContract } from '@casitafeliz/loom-contract/internal';
import { expect, test } from 'vitest';
import { z } from 'zod';
import { fakeProvider } from './index.ts';

const apiKey = defineGuard({
  name: 'apiKey',
  description: 'A key per client',
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

const PAYMENT_ID = 'pay-1';
const amount = 1200;

type PaymentOutcome = ReceivedOutcome<typeof paymentsDeps, 'getPayment'>;

/** The code under test: it asks for a payment until the Provider answers it, keeping each Outcome. */
class SettlementService {
  readonly outcomes: PaymentOutcome[] = [];
  readonly #payments: Client<typeof paymentsDeps, 'x-api-key'>;

  constructor(payments: Client<typeof paymentsDeps, 'x-api-key'>) {
    this.#payments = payments;
  }

  async settle(paymentId: string): Promise<void> {
    for (let attempt = 0; attempt < 7; attempt += 1) {
      const outcome = await this.#payments.getPayment({ params: { paymentId } });
      this.outcomes.push(outcome);
      if (outcome.kind === 'success') {
        return;
      }
    }
  }
}

test('the README’s fakeProvider example runs: each Outcome in order, and the calls listed', async () => {
  const payments = fakeProvider(paymentsDeps);
  payments
    .on('getPayment')
    .once((r) => r.reject('NOT_FOUND'))
    .once((r) => r.reject({ unknown: 'CARD_EXPIRED' }, {}))
    .once((r) => r.fault({ committed: 'no', retryable: true }))
    .once((r) => r.noConnection())
    .once((r) => r.reset())
    .once((r) => r.status(502))
    .otherwise((r, { params }) => r.success({ id: params.paymentId, amount }));

  const settlement = new SettlementService(payments.client({ headers: { 'x-api-key': 'k' } }));
  await settlement.settle(PAYMENT_ID);
  const calls = payments.calls('getPayment');

  expect(settlement.outcomes).toMatchObject([
    { kind: 'rejection', known: true, code: 'NOT_FOUND', message: 'Not found', body: undefined },
    { kind: 'rejection', known: false, code: 'CARD_EXPIRED', message: 'CARD_EXPIRED', body: {} },
    { kind: 'fault', committed: 'no', retryable: true, message: 'Internal error' },
    { kind: 'fault', committed: 'no', retryable: true, message: 'No connection to the Provider' },
    { kind: 'fault', committed: 'unknown', retryable: true, message: 'The connection failed' },
    { kind: 'fault', committed: 'unknown', retryable: false, message: 'The Provider answered 502' },
    { kind: 'success', value: { id: PAYMENT_ID, amount }, headers: {} },
  ]);
  const input = { params: { paymentId: PAYMENT_ID }, headers: { 'x-api-key': 'k' } };
  expect(calls).toEqual(Array.from({ length: 7 }, () => ({ kind: 'valid', input })));
});
