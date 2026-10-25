import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  type ContractPackage,
  defineContract,
  defineDependency,
  defineEndpoint,
  defineGroup,
  defineGuard,
  defineRejection,
  type Endpoint,
  type Method,
  notFound,
  openEnum,
  openEnumReader,
  type ProvidedStandardRejections,
} from '@cf-loom/contract';
import { exportedSnapshotOf, snapshotOf, validateContract } from '@cf-loom/contract/internal';
import { admit, fault, handle, reject, success } from '@cf-loom/handlers';
import { serve } from '@cf-loom/server';
import { nodeHttp } from '@cf-loom/server/node-http';
import { afterAll, beforeAll, describe, expect, expectTypeOf, test } from 'vitest';
import { z } from 'zod';
import { providedStandardRejections } from '../test/standard-rejections.ts';
import { client, type DeprecationNotice } from './index.ts';

const orderLocked = defineRejection({
  code: 'ORDER_LOCKED',
  status: 409,
  message: 'The order can no longer be changed',
  body: z.object({ lockedAt: z.iso.datetime() }),
});

const apiKey = defineGuard({
  name: 'apiKey',
  description: 'A key per Caller',
  demands: { headers: z.object({ 'x-api-key': z.string() }) },
  context: z.object({ callerId: z.string() }),
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
  const Standards extends ProvidedStandardRejections,
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
  const exportedSnapshot = exportedSnapshotOf(snapshot);
  const name = 'orders-service';
  return { name, version: '1.0.0', endpoints, events: {}, standardRejections, exportedSnapshot };
}

const defaultStandards = providedStandardRejections();

const exported = { getOrder: getOrderReader, createOrder, cancelOrder, archiveOrder, refundOrder };

const orders = contractPackageOf(exported, defaultStandards, [
  getOrder,
  createOrder,
  cancelOrder,
  archiveOrder,
  refundOrder,
]);

const ordersDependency = defineDependency({
  provider: orders,
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
      return success({ headers, body: { id: params.orderId, by: key.callerId } });
    }),
    createOrder: handle(createOrder, ({ body }) => success(body)),
    cancelOrder: handle(cancelOrder, () => fault({ committed: 'no', retryable: true })),
  },
  guards: { apiKey: handle(apiKey, ({ headers }) => admit({ callerId: headers['x-api-key'] })) },
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
  return client(ordersDependency, {
    baseUrl,
    headers: { 'x-api-key': async () => 'caller-7' },
    onDeprecation: (notice) => notices.push(notice),
  });
}

const declarable = [
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'OPTIONS',
] as const satisfies readonly Method[];

/** What a Caller receives from an Endpoint with `method`, served alone, that answers a Rejection and then a Fault. */
async function outcomesOfEndpointWith(method: Method) {
  const probe = defineEndpoint({
    name: 'probe',
    method,
    path: '/probes/:answer',
    visibility: 'public',
    description: 'Answers what its path says',
    input: { params: z.object({ answer: z.enum(['rejection', 'fault']) }) },
    success: { status: 204 },
    rejections: [orderLocked],
  });
  const group = defineGroup({ name: 'probes', description: 'Probes', endpoints: [probe] });
  const service = defineContract({ name: 'orders-service', groups: [group] });
  const answering = handle(probe, ({ params }) =>
    params.answer === 'rejection'
      ? reject(orderLocked, { lockedAt: '2026-10-18T10:00:00Z' })
      : fault({ committed: 'no', retryable: true }),
  );
  const probeServer = nodeHttp(
    serve(service, { endpoints: { probe: answering }, guards: {}, deprecatedAt: {} }),
  );
  await new Promise<void>((resolve) => probeServer.listen(0, '127.0.0.1', resolve));
  try {
    const probeUrl = `http://127.0.0.1:${(probeServer.address() as AddressInfo).port}/`;
    const provider = contractPackageOf({ probe }, defaultStandards);
    const probes = client(defineDependency({ provider, endpoints: [probe] }), {
      baseUrl: probeUrl,
    });
    const rejection = await probes.probe({ params: { answer: 'rejection' } });
    const faulted = await probes.probe({ params: { answer: 'fault' } });
    return { method, rejection, fault: faulted };
  } finally {
    probeServer.close();
  }
}

describe('end to end against serve through node:http and the global fetch', () => {
  test('every declarable method delivers a Rejection with its body and a Fault with its committed', async () => {
    expectTypeOf<Exclude<Method, (typeof declarable)[number]>>().toEqualTypeOf<never>();

    const delivered = [];
    for (const method of declarable) {
      delivered.push(await outcomesOfEndpointWith(method));
    }

    expect(delivered).toEqual(
      declarable.map((method) => ({
        method,
        rejection: {
          kind: 'rejection',
          source: 'provider',
          code: 'ORDER_LOCKED',
          status: 409,
          message: 'The order can no longer be changed',
          body: { lockedAt: '2026-10-18T10:00:00Z' },
        },
        fault: {
          kind: 'fault',
          source: 'provider',
          status: 503,
          committed: 'no',
          retryable: true,
          message: 'Internal error',
        },
      })),
    );
  });

  test('a Success arrives with its status, its typed headers and its body', async () => {
    const outcome = await ordersClient().getOrder({ params: { orderId: 'o-1' } });

    expect(outcome).toEqual({
      kind: 'success',
      status: 200,
      headers: { 'x-stage': 'shipped', 'x-count': 2 },
      body: { id: 'o-1', by: 'caller-7' },
    });
  });

  test('a Success the client receives equals what a direct call of its EndpointHandler returns', async () => {
    const direct = await handlers.endpoints.getOrder(
      { params: { orderId: 'o-1' }, headers: { 'x-api-key': 'caller-7' } },
      { apiKey: { callerId: 'caller-7' } },
    );

    const outcome = await ordersClient().getOrder({ params: { orderId: 'o-1' } });

    expect(outcome).toEqual(direct);
  });

  test('a Standard and a declared Rejection arrive with their status and, where declared, their body', async () => {
    const orders = ordersClient();

    const outcomes = [
      await orders.getOrder({ params: { orderId: 'missing' } }),
      await orders.getOrder({ params: { orderId: 'locked' } }),
    ];

    expect(outcomes).toStrictEqual([
      {
        kind: 'rejection',
        source: 'provider',
        code: 'NOT_FOUND',
        status: 404,
        message: 'Not found',
      },
      {
        kind: 'rejection',
        source: 'provider',
        code: 'ORDER_LOCKED',
        status: 409,
        message: 'The order can no longer be changed',
        body: { lockedAt: '2026-10-18T10:00:00Z' },
      },
    ]);
  });

  test('the invalid-input Rejection the Provider answers arrives with source provider', async () => {
    const keyless = client(ordersDependency, {
      baseUrl,
      fetch: (request) => {
        request.headers.delete('x-api-key');
        return fetch(request);
      },
    });

    const outcome = await keyless.getOrder({
      params: { orderId: 'o-1' },
      headers: { 'x-api-key': 'caller-7' },
    });

    expect(outcome).toMatchObject({
      kind: 'rejection',
      source: 'provider',
      code: 'INVALID_INPUT',
      status: 400,
    });
  });

  test('a Fault the Handler returned arrives as sent', async () => {
    const outcome = await ordersClient().cancelOrder({ params: { orderId: 'o-1' } });

    expect(outcome).toEqual({
      kind: 'fault',
      source: 'provider',
      status: 503,
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
      await client(ordersDependency, {
        baseUrl,
        fetch: (request) => fetch(new Request(request, { body: JSON.stringify(large) })),
      }).createOrder({ body: large }),
    ];

    expect(outcomes).toMatchObject([
      { source: 'provider', status: 410, code: 'RETIRED', committed: 'no', retryable: false },
      {
        source: 'provider',
        status: 404,
        code: 'NO_SUCH_ENDPOINT',
        committed: 'no',
        retryable: false,
      },
      {
        source: 'provider',
        status: 500,
        code: 'INVALID_OUTCOME',
        committed: 'unknown',
        retryable: false,
      },
      {
        source: 'provider',
        status: 413,
        code: 'BODY_TOO_LARGE',
        committed: 'no',
        retryable: false,
      },
    ]);
  });

  test('a Deprecated Endpoint works, and its Deprecation is told once', async () => {
    const orders = ordersClient();

    const outcome = await orders.createOrder({ body: { quantity: 3 } });
    await orders.createOrder({ body: { quantity: 4 } });

    expect(outcome).toEqual({ kind: 'success', status: 201, body: { quantity: 3 } });
    expect(notices).toEqual([
      { provider: 'orders-service', endpoint: 'createOrder', deprecatedAt: '2026-10-17T09:30:00Z' },
    ]);
  });
});

/** A Provider that answers `status` with a `location` at another origin, and that other origin, which records what reaches it. */
async function redirectingTo(status: 307 | 303) {
  const reached: string[] = [];
  const elsewhere = createServer((request, response) => {
    reached.push(`${request.method} ${request.url} ${request.headers['x-api-key']}`);
    response.writeHead(200, { 'content-type': 'application/json' }).end('{"id":"elsewhere"}');
  });
  await new Promise<void>((resolve) => elsewhere.listen(0, '127.0.0.1', resolve));
  const elsewherePort = (elsewhere.address() as AddressInfo).port;
  const redirecting = createServer((_request, response) => {
    response.writeHead(status, { location: `http://localhost:${elsewherePort}/x` }).end();
  });
  await new Promise<void>((resolve) => redirecting.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${(redirecting.address() as AddressInfo).port}/`;
  const close = () => {
    redirecting.close();
    elsewhere.close();
  };
  return { baseUrl, reached, close };
}

describe('a redirect', () => {
  test('a cross-origin 307 is a Fault and the other origin receives nothing', async () => {
    const { baseUrl, reached, close } = await redirectingTo(307);
    const orders = client(ordersDependency, { baseUrl, headers: { 'x-api-key': 'SECRET' } });

    const outcome = await orders.getOrder({ params: { orderId: 'o-1' } });
    close();

    expect(outcome).toEqual({
      kind: 'fault',
      source: 'status',
      status: 307,
      committed: 'unknown',
      retryable: false,
      message: 'The Provider answered 307',
    });
    expect(reached).toEqual([]);
  });

  test('a 303 is a Fault and no GET follows it', async () => {
    const { baseUrl, reached, close } = await redirectingTo(303);
    const orders = client(ordersDependency, { baseUrl });

    const outcome = await orders.createOrder({ body: { quantity: 1 } });
    close();

    expect(outcome).toEqual({
      kind: 'fault',
      source: 'status',
      status: 303,
      committed: 'unknown',
      retryable: false,
      message: 'The Provider answered 303',
    });
    expect(reached).toEqual([]);
  });
});

describe('serve in the same process', () => {
  test('what serve returns is a client’s fetch with no adapter', async () => {
    const orders = client(ordersDependency, {
      baseUrl: 'http://orders.test',
      headers: { 'x-api-key': 'caller-7' },
      fetch: serve(provider, handlers),
    });

    const outcome = await orders.getOrder({ params: { orderId: 'o-1' } });

    expect(outcome).toEqual({
      kind: 'success',
      status: 200,
      headers: { 'x-stage': 'shipped', 'x-count': 2 },
      body: { id: 'o-1', by: 'caller-7' },
    });
  });
});
