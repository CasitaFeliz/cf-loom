import type { DeprecationNotice } from '@cf-loom/client';
import {
  defineDependency,
  defineEndpoint,
  defineGroup,
  defineService,
  type Endpoint,
  notFound,
} from '@cf-loom/contract';
import { snapshotOf, validateRoot } from '@cf-loom/contract/internal';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { type Exportable, providedEndpointsOf } from '../test/provided.ts';
import { aRootPackage } from '../test/root-package.ts';
import { providedStandardRejections } from '../test/standard-rejections.ts';
import { fakeProvider, type StepBuilder } from './index.ts';

const getPayment = defineEndpoint({
  name: 'getPayment',
  method: 'GET',
  path: '/payments/:paymentId',
  visibility: 'internal',
  description: 'One payment',
  lifecycle: 'deprecated',
  deprecatedAt: '2026-10-17T09:30:00Z',
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

/** The Provider's Contract Package, its Deprecated Endpoints dated as they declare. */
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

const paymentsDependencyPackage = contractPackageOf({ getPayment, listPayments });
const paymentsDependency = defineDependency({
  endpoints: [
    paymentsDependencyPackage.endpoints.getPayment,
    paymentsDependencyPackage.endpoints.listPayments,
  ],
});

type Builder = StepBuilder<typeof paymentsDependency, 'getPayment'>;

const deprecation = `@${Date.parse('2026-10-17T09:30:00Z') / 1000}`;

describe('fakeProvider: Deprecation', () => {
  test.each([
    ['a Success', (r: Builder) => r.success({ id: 'pay-1' })],
    ['a Rejection', (r: Builder) => r.reject('NOT_FOUND')],
    ['a code the Provider does not declare', (r: Builder) => r.unknownRejection('CARD_EXPIRED')],
    ['a Fault', (r: Builder) => r.fault({ committed: 'no', retryable: true })],
    ['a reserved code', (r: Builder) => r.fault({ code: 'INVALID_OUTCOME' })],
    ['a bare status', (r: Builder) => r.status(502)],
  ])('%s of a Deprecated Endpoint carries Deprecation', async (_name, step) => {
    const payments = fakeProvider(paymentsDependency);
    payments.on('getPayment').otherwise(step);

    const response = await payments.fetch(
      new Request('https://payments-service.test/payments/pay-1'),
    );

    expect(response.headers.get('deprecation')).toBe(deprecation);
  });

  test('the invalid-input Rejection of a Deprecated Endpoint carries Deprecation', async () => {
    const payments = fakeProvider(paymentsDependency);

    const response = await payments.fetch(new Request('https://payments-service.test/payments/ab'));

    expect([response.status, response.headers.get('deprecation')]).toEqual([400, deprecation]);
  });

  test('a Deprecated Endpoint whose deprecatedAt lies in the future carries Deprecation too', async () => {
    const scheduled = defineEndpoint({
      name: 'scheduled',
      method: 'GET',
      path: '/scheduled',
      visibility: 'internal',
      description: 'Deprecated as of a day to come',
      lifecycle: 'deprecated',
      deprecatedAt: '2999-01-01T00:00:00Z',
      success: { status: 204 },
    });
    const provided = contractPackageOf({ scheduled });
    const dependency = defineDependency({
      endpoints: [provided.endpoints.scheduled],
    });
    const payments = fakeProvider(dependency);
    payments.on('scheduled').otherwise((r) => r.success());

    const response = await payments.fetch(new Request('https://payments-service.test/scheduled'));

    expect(response.headers.get('deprecation')).toBe('@32472144000');
  });

  test('onDeprecation is told once per method, and never for an Active Endpoint', async () => {
    const payments = fakeProvider(paymentsDependency);
    payments.on('getPayment').otherwise((r) => r.success({ id: 'pay-1' }));
    payments.on('listPayments').otherwise((r) => r.success([]));
    const notices: DeprecationNotice[] = [];
    const client = payments.client({ onDeprecation: (notice) => notices.push(notice) });

    await client.getPayment({ params: { paymentId: 'pay-1' } });
    await client.getPayment({ params: { paymentId: 'pay-2' } });
    const listed = await payments.fetch(new Request('https://payments-service.test/payments'));
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
