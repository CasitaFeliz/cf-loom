import type { Client, ReceivedOutcome } from '@cf-loom/client';
import {
  type ContractPackage,
  defineContract,
  defineDependencies,
  defineEndpoint,
  defineEvent,
  defineGroup,
  defineGuard,
  defineSubscription,
  type Endpoint,
  notFound,
} from '@cf-loom/contract';
import { exportedSnapshotOf, snapshotOf, validateContract } from '@cf-loom/contract/internal';
import { handle, withReader } from '@cf-loom/handlers';
import { expect, test } from 'vitest';
import { z } from 'zod';
import { fakeEvent, fakeProvider } from './index.ts';

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

const paymentSettledV1 = defineEvent({
  name: 'PaymentSettled',
  version: 1,
  visibility: 'internal',
  description: 'A payment was settled',
  body: z.object({ paymentId: z.string() }),
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
  const exportedSnapshot = exportedSnapshotOf(snapshot);
  const standardRejections = {
    invalidInput: { code: 'INVALID_INPUT', status: 400, message: 'Invalid input' },
    notFound: { code: 'NOT_FOUND', status: 404, message: 'Not found' },
    notImplemented: { code: 'NOT_IMPLEMENTED', status: 501, message: 'Not implemented' },
  } as const;
  const name = 'payments-service';
  const events = { paymentSettledV1 };
  return { name, version: '1.0.0', endpoints, events, standardRejections, exportedSnapshot };
}

const paymentsDeps = defineDependencies(contractPackageOf({ getPayment }), {
  endpoints: [getPayment],
  events: [paymentSettledV1],
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

test('the README’s fakeEvent example runs: a faked PaymentSettled reaches notifyOnSettledHandler', async () => {
  const notifyOnSettled = defineSubscription({
    name: 'notify-on-settled',
    event: paymentsDeps.events.paymentSettledV1,
  });
  const received: unknown[] = [];
  const notifyOnSettledHandler = handle(
    withReader(notifyOnSettled, paymentsDeps.events.paymentSettledV1.body),
    (body) => {
      received.push(body);
      return undefined;
    },
  );

  const settled = fakeEvent(paymentsDeps.events.paymentSettledV1, { paymentId: PAYMENT_ID });
  const answer = await notifyOnSettledHandler(settled, {
    messageId: 'PaymentSettled.v1:pay-1',
    factId: 'pay-1',
    deliveryCount: 1,
  });

  expect(answer).toBeUndefined();
  expect(received).toEqual([{ paymentId: PAYMENT_ID }]);
});
