import {
  type ContractPackage,
  defineContract,
  defineDependencies,
  defineEndpoint,
  defineGroup,
  defineRejection,
  type Endpoint,
  notFound,
  type StandardRejections,
} from '@casitafeliz/loom-contract';
import { snapshotOf, validateContract } from '@casitafeliz/loom-contract/internal';
import { describe, expect, expectTypeOf, test } from 'vitest';
import { z } from 'zod';
import { type Client, client, type ReceivedOutcome } from './index.ts';

const orderLocked = defineRejection({
  code: 'ORDER_LOCKED',
  status: 409,
  message: 'Locked',
  body: z.object({ lockedAt: z.string() }),
});

const getOrder = defineEndpoint({
  name: 'getOrder',
  method: 'GET',
  path: '/orders/:orderId',
  visibility: 'public',
  description: 'One order',
  input: {
    params: z.object({ orderId: z.string() }),
    headers: z.object({ 'x-api-key': z.string(), 'x-region': z.enum(['eu', 'us']) }),
  },
  success: { status: 200, body: z.object({ id: z.string() }) },
  rejections: [notFound, orderLocked],
});

const listOrders = defineEndpoint({
  name: 'listOrders',
  method: 'GET',
  path: '/orders',
  visibility: 'public',
  description: 'Every order',
  input: {
    query: z.object({ page: z.int().optional() }),
    headers: z.object({ 'x-api-key': z.string(), 'x-region': z.string() }),
  },
  success: { status: 200, body: z.object({ ids: z.array(z.string()) }) },
});

const ping = defineEndpoint({
  name: 'ping',
  method: 'GET',
  path: '/ping',
  visibility: 'public',
  description: 'Whether the Service is up',
  success: { status: 204 },
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
  const group = defineGroup({ name: 'orders', description: 'Orders', endpoints: listed });
  const root = defineContract({ name: 'orders-service', groups: [group] });
  const rootPackage = {
    packageName: 'orders-service',
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
  const name = 'orders-service';
  return { name, version: '1.0.0', endpoints, events: {}, standardRejections, exportedSnapshot };
}

const standards = {
  invalidInput: { code: 'BAD_REQUEST', status: 400, message: 'Invalid' },
  notFound: { code: 'MISSING', status: 404, message: 'Missing' },
  notImplemented: { code: 'NOT_YET', status: 501, message: 'Not yet' },
} as const;

const orders = contractPackageOf({ getOrder, listOrders, ping }, standards);

const ordersDeps = defineDependencies(orders, { endpoints: [getOrder, listOrders] });

const baseUrl = 'http://orders.test';

describe('the client’s types', () => {
  test('has a method only for each Endpoint the Dependency lists', () => {
    const orders = client(ordersDeps, { baseUrl });

    expectTypeOf(orders).toHaveProperty('getOrder');
    expectTypeOf(orders).not.toHaveProperty('ping');
    expect(Object.keys(orders)).toEqual(['getOrder', 'listOrders']);
  });

  test('a required header not given to client() stays required on each call', () => {
    const orders = client(ordersDeps, { baseUrl, headers: { 'x-api-key': 'k' } });
    type Input = Parameters<typeof orders.getOrder>[0];

    expectTypeOf<{
      params: { orderId: string };
      headers: { 'x-region': 'eu' };
    }>().toExtend<Input>();
    expectTypeOf<{ params: { orderId: string } }>().not.toExtend<Input>();
    expect(orders).toBeDefined();
  });

  test('the first argument may be left out when no part of the Input is required', () => {
    const configured = client(ordersDeps, {
      baseUrl,
      headers: { 'x-api-key': 'k', 'x-region': 'eu' },
    });
    const bare = client(ordersDeps, { baseUrl });

    const leftOut = () => configured.listOrders();
    // @ts-expect-error: without the headers given, they are required, so the Input is too
    const required = () => bare.listOrders();

    expectTypeOf(configured.listOrders).toBeCallableWith();
    expectTypeOf<undefined>().not.toExtend<Parameters<typeof bare.listOrders>[0]>();
    expect([leftOut, required]).toHaveLength(2);
  });

  test('a header given to client() takes the Input’s type, across every Endpoint declaring it', () => {
    type Options = Parameters<typeof client<typeof ordersDeps, 'x-region'>>[1];
    type Region = NonNullable<Options['headers']>['x-region'];

    expectTypeOf<'eu'>().toExtend<Region>();
    expectTypeOf<'fr'>().not.toExtend<Region>();
    expectTypeOf<() => Promise<'us'>>().toExtend<Region>();
    expect(client).toBeDefined();
  });

  test('Client<typeof deps, names> is what client() returns with those headers given', () => {
    const configured: Client<typeof ordersDeps, 'x-api-key'> = client(ordersDeps, {
      baseUrl,
      headers: { 'x-api-key': 'k' },
    });

    expectTypeOf(configured).toEqualTypeOf<Client<typeof ordersDeps, 'x-api-key'>>();
    expect(configured).toBeDefined();
  });

  test('checking known narrows a Rejection by code, the Provider’s Standard codes included', () => {
    type Outcome = ReceivedOutcome<typeof getOrder, typeof standards>;
    type Known = Extract<Outcome, { readonly kind: 'rejection'; readonly known: true }>;

    expectTypeOf<Known['code']>().toEqualTypeOf<
      'MISSING' | 'ORDER_LOCKED' | 'BAD_REQUEST' | 'NOT_YET'
    >();
    expectTypeOf<Extract<Known, { readonly code: 'ORDER_LOCKED' }>['body']>().toEqualTypeOf<{
      lockedAt: string;
    }>();
    expectTypeOf<Extract<Known, { readonly code: 'MISSING' }>['body']>().toEqualTypeOf<undefined>();
    expect(standards.notFound.code).toBe('MISSING');
  });
});
