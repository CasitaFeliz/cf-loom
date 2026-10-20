import type { DeprecationNotice } from '@casitafeliz/loom-client';
import {
  type ContractPackage,
  defineContract,
  defineDependencies,
  defineEndpoint,
  defineGroup,
  type Endpoint,
  notFound,
} from '@casitafeliz/loom-contract';
import { snapshotOf, validateContract } from '@casitafeliz/loom-contract/internal';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { fakeProvider, type StepBuilder } from './index.ts';

const getPayment = defineEndpoint({
  name: 'getPayment',
  method: 'GET',
  path: '/payments/:paymentId',
  visibility: 'internal',
  description: 'One payment',
  lifecycle: 'deprecated',
  input: { params: z.object({ paymentId: z.string().min(3) }) },
  success: { status: 200, body: z.object({ id: z.string() }) },
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

/** The Provider's Contract Package, its Deprecated Endpoint stamped when the clock read `now`. */
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
  const now = Date.parse('2026-10-17T09:30:00Z');
  const context = { generator: 'test', packages: [], committed: undefined, now };
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

const paymentsDeps = defineDependencies(contractPackageOf({ getPayment, listPayments }), {
  endpoints: [getPayment, listPayments],
});

type Builder = StepBuilder<typeof getPayment, (typeof paymentsDeps)['standardRejections']>;

const deprecation = `@${Date.parse('2026-10-17T09:30:00Z') / 1000}`;

describe('fakeProvider: Deprecation', () => {
  test.each([
    ['a Success', (r: Builder) => r.success({ id: 'pay-1' })],
    ['a Rejection', (r: Builder) => r.reject('NOT_FOUND')],
    [
      'a code the Provider does not declare',
      (r: Builder) => r.reject({ unknown: 'CARD_EXPIRED' }, {}),
    ],
    ['a Fault', (r: Builder) => r.fault({ committed: 'no', retryable: true })],
    ['a reserved code', (r: Builder) => r.fault({ code: 'INVALID_OUTCOME' })],
    ['a bare status', (r: Builder) => r.status(502)],
  ])('%s of a Deprecated Endpoint carries Deprecation', async (_name, step) => {
    const payments = fakeProvider(paymentsDeps);
    payments.on('getPayment').otherwise(step);

    const response = await payments.fetch('https://payments-service.test/payments/pay-1', {});

    expect(response.headers.get('deprecation')).toBe(deprecation);
  });

  test('the invalid-input Rejection of a Deprecated Endpoint carries Deprecation', async () => {
    const payments = fakeProvider(paymentsDeps);

    const response = await payments.fetch('https://payments-service.test/payments/ab', {});

    expect([response.status, response.headers.get('deprecation')]).toEqual([400, deprecation]);
  });

  test('onDeprecation is told once per method, and never for an Active Endpoint', async () => {
    const payments = fakeProvider(paymentsDeps);
    payments.on('getPayment').otherwise((r) => r.success({ id: 'pay-1' }));
    payments.on('listPayments').otherwise((r) => r.success([]));
    const notices: DeprecationNotice[] = [];
    const client = payments.client({ onDeprecation: (notice) => notices.push(notice) });

    await client.getPayment({ params: { paymentId: 'pay-1' } });
    await client.getPayment({ params: { paymentId: 'pay-2' } });
    const listed = await payments.fetch('https://payments-service.test/payments', {});
    await client.listPayments();

    expect(listed.headers.has('deprecation')).toBe(false);
    expect(notices).toEqual([
      {
        provider: 'payments-service',
        endpoint: 'getPayment',
        deprecatedAt: '2026-10-17T09:30:00Z',
      },
    ]);
  });
});
