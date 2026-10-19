import type { AddressInfo } from 'node:net';
import {
  type ContractPackage,
  defineContract,
  defineDependencies,
  defineEndpoint,
  defineGroup,
  defineGuard,
  defineRejection,
  type Endpoint,
  notFound,
  openEnum,
  openEnumReader,
  type StandardRejections,
} from '@casitafeliz/loom-contract';
import { snapshotOf, validateContract } from '@casitafeliz/loom-contract/internal';
import { admit, fault, handle, reject, success } from '@casitafeliz/loom-handlers';
import { serve } from '@casitafeliz/loom-server';
import { nodeHttp } from '@casitafeliz/loom-server/node-http';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { z } from 'zod';
import { client, type DeprecationNotice } from './index.ts';

const orderLocked = defineRejection({
  code: 'ORDER_LOCKED',
  status: 409,
  message: 'The order can no longer be changed',
  body: z.object({ lockedAt: z.iso.datetime() }),
});

const apiKey = defineGuard({
  name: 'apiKey',
  description: 'A key per client',
  demands: { headers: z.object({ 'x-api-key': z.string() }) },
  context: z.object({ clientId: z.string() }),
});

/** An Endpoint declared once, as the Provider writes it and as its Contract Package rebuilds it. */
function getOrderOf<const Stage extends z.ZodType>(stage: Stage) {
  return defineEndpoint({
    name: 'getOrder',
    method: 'GET',
    path: '/orders/:orderId',
    visibility: 'public',
    description: 'One order',
    guards: [apiKey],
    input: {
      params: z.object({ orderId: z.string() }),
      headers: z.object({ 'x-api-key': z.string() }),
    },
    success: {
      status: 200,
      headers: z.object({ 'x-stage': stage, 'x-count': z.int() }),
      body: z.object({ id: z.string(), by: z.string() }),
    },
    rejections: [notFound, orderLocked],
  });
}

const getOrder = getOrderOf(openEnum(['packed', 'shipped']));

const getOrderReader = getOrderOf(openEnumReader(['packed', 'shipped']));

const createOrder = defineEndpoint({
  name: 'createOrder',
  method: 'POST',
  path: '/orders',
  visibility: 'public',
  description: 'A new order',
  lifecycle: 'deprecated',
  input: { body: z.object({ quantity: z.int() }) },
  success: { status: 201, body: z.object({ quantity: z.int() }) },
});

const cancelOrder = defineEndpoint({
  name: 'cancelOrder',
  method: 'DELETE',
  path: '/orders/:orderId',
  visibility: 'public',
  description: 'Cancels an order',
  input: { params: z.object({ orderId: z.string() }) },
  success: { status: 204 },
});

const archiveOrder = defineEndpoint({
  name: 'archiveOrder',
  method: 'POST',
  path: '/orders/:orderId/archive',
  visibility: 'public',
  description: 'Archives an order',
  input: { params: z.object({ orderId: z.string() }) },
  success: { status: 204 },
});

const retiredArchiveOrder = defineEndpoint({
  name: 'archiveOrder',
  method: 'POST',
  path: '/orders/:orderId/archive',
  visibility: 'public',
  description: 'Archives an order',
  lifecycle: 'retired',
  input: { params: z.object({ orderId: z.string() }) },
  success: { status: 204 },
});

const refundOrder = defineEndpoint({
  name: 'refundOrder',
  method: 'POST',
  path: '/orders/:orderId/refund',
  visibility: 'public',
  description: 'Not served by this Release',
  input: { params: z.object({ orderId: z.string() }) },
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

const defaultStandards = {
  invalidInput: { code: 'INVALID_INPUT', status: 400, message: 'Invalid input' },
  notFound: { code: 'NOT_FOUND', status: 404, message: 'Not found' },
  notImplemented: { code: 'NOT_IMPLEMENTED', status: 501, message: 'Not implemented' },
} as const;

const exported = { getOrder: getOrderReader, createOrder, cancelOrder, archiveOrder, refundOrder };

const orders = contractPackageOf(exported, defaultStandards, [
  getOrder,
  createOrder,
  cancelOrder,
  archiveOrder,
  refundOrder,
]);

const ordersDeps = defineDependencies(orders, {
  endpoints: [getOrderReader, createOrder, cancelOrder, archiveOrder, refundOrder],
});

/** The Provider's Release: `refundOrder` not served yet, `archiveOrder` Retired. */
const provider = defineContract({
  name: 'orders-service',
  groups: [
    defineGroup({
      name: 'orders',
      description: 'Orders',
      endpoints: [getOrder, createOrder, cancelOrder, retiredArchiveOrder],
    }),
  ],
});

const handlers = {
  endpoints: {
    getOrder: handle(getOrder, ({ params }, { apiKey: key }) => {
      if (params.orderId === 'missing') {
        return reject(notFound);
      }
      if (params.orderId === 'locked') {
        return reject(orderLocked, { lockedAt: '2026-10-18T10:00:00Z' });
      }
      if (params.orderId === 'broken') {
        return success({
          headers: { 'x-stage': 'packed', 'x-count': -0.5 },
          body: { id: 'x', by: 'y' },
        });
      }
      const headers = { 'x-stage': 'shipped', 'x-count': 2 } as const;
      return success({ headers, body: { id: params.orderId, by: key.clientId } });
    }),
    createOrder: handle(createOrder, ({ body }) => success(body)),
    cancelOrder: handle(cancelOrder, () => fault({ committed: 'no', retryable: true })),
  },
  guards: { apiKey: handle(apiKey, ({ headers }) => admit({ clientId: headers['x-api-key'] })) },
  deprecatedAt: { createOrder: '2026-10-17T09:30:00Z' },
};

const server = nodeHttp(
  serve(provider, handlers, { maxBodyBytes: 64, onServiceFault: () => undefined }),
);
const notices: DeprecationNotice[] = [];
let baseUrl = '';

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
});

afterAll(() => {
  server.close();
});

function ordersClient() {
  return client(ordersDeps, {
    baseUrl,
    headers: { 'x-api-key': async () => 'client-7' },
    onDeprecation: (notice) => notices.push(notice),
  });
}

describe('end to end against serve through node:http and the global fetch', () => {
  test('a Success arrives with its body and its typed headers', async () => {
    const outcome = await ordersClient().getOrder({ params: { orderId: 'o-1' } });

    expect(outcome).toEqual({
      kind: 'success',
      value: { id: 'o-1', by: 'client-7' },
      headers: { 'x-stage': 'shipped', 'x-count': 2 },
    });
  });

  test('a Standard and a declared Rejection arrive known, with their bodies', async () => {
    const orders = ordersClient();

    const outcomes = [
      await orders.getOrder({ params: { orderId: 'missing' } }),
      await orders.getOrder({ params: { orderId: 'locked' } }),
    ];

    expect(outcomes).toEqual([
      { kind: 'rejection', known: true, code: 'NOT_FOUND', message: 'Not found', body: undefined },
      {
        kind: 'rejection',
        known: true,
        code: 'ORDER_LOCKED',
        message: 'The order can no longer be changed',
        body: { lockedAt: '2026-10-18T10:00:00Z' },
      },
    ]);
  });

  test('a Fault the Handler returned arrives as sent', async () => {
    const outcome = await ordersClient().cancelOrder({ params: { orderId: 'o-1' } });

    expect(outcome).toEqual({
      kind: 'fault',
      committed: 'no',
      retryable: true,
      message: 'Internal error',
    });
  });

  test('the reserved codes arrive as serve answers them', async () => {
    const orders = ordersClient();
    const large = { quantity: 1, padding: 'x'.repeat(100) } as { quantity: number };

    const outcomes = [
      await orders.archiveOrder({ params: { orderId: 'o-1' } }),
      await orders.refundOrder({ params: { orderId: 'o-1' } }),
      await orders.getOrder({ params: { orderId: 'broken' } }),
      await client(ordersDeps, {
        baseUrl,
        fetch: (url, init) => fetch(url, { ...init, body: JSON.stringify(large) }),
      }).createOrder({ body: large }),
    ];

    expect(outcomes).toMatchObject([
      { kind: 'fault', code: 'RETIRED', committed: 'no', retryable: false },
      { kind: 'fault', code: 'NO_SUCH_ENDPOINT', committed: 'no', retryable: false },
      { kind: 'fault', code: 'INVALID_OUTCOME', committed: 'unknown', retryable: false },
      { kind: 'fault', code: 'BODY_TOO_LARGE', committed: 'no', retryable: false },
    ]);
  });

  test('a Deprecated Endpoint works, and its Deprecation is told once', async () => {
    const orders = ordersClient();

    const outcome = await orders.createOrder({ body: { quantity: 3 } });
    await orders.createOrder({ body: { quantity: 4 } });

    expect(outcome).toEqual({ kind: 'success', value: { quantity: 3 }, headers: {} });
    expect(notices).toEqual([
      { provider: 'orders-service', endpoint: 'createOrder', deprecatedAt: '2026-10-17T09:30:00Z' },
    ]);
  });
});
