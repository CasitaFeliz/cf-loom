import {
  type ContractPackage,
  defineContract,
  defineDependencies,
  defineEndpoint,
  defineGroup,
  type Endpoint,
  type StandardRejections,
} from '@casitafeliz/loom-contract';
import { snapshotOf, validateContract } from '@casitafeliz/loom-contract/internal';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { client } from './index.ts';

const getOrder = defineEndpoint({
  name: 'getOrder',
  method: 'GET',
  path: '/orders/:orderId',
  visibility: 'public',
  description: 'One order',
  input: {
    params: z.object({ orderId: z.string() }),
    headers: z.object({ 'x-api-key': z.string(), authorization: z.string() }),
  },
  success: { status: 204 },
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

const defaultStandards = {
  invalidInput: { code: 'INVALID_INPUT', status: 400, message: 'Invalid input' },
  notFound: { code: 'NOT_FOUND', status: 404, message: 'Not found' },
  notImplemented: { code: 'NOT_IMPLEMENTED', status: 501, message: 'Not implemented' },
} as const;

const orders = contractPackageOf({ getOrder, ping }, defaultStandards);

const ordersDeps = defineDependencies(orders, { endpoints: [getOrder, ping] });

/** Every request a client sent, as its `fetch` received it. */
function recorded() {
  const sent: Request[] = [];
  const fetch = async (url: string, init: RequestInit) => {
    sent.push(new Request(url, init));
    return new Response(null, { status: 204 });
  };
  return { sent, fetch };
}

const params = { params: { orderId: 'o-1' } };

describe('headers given to client()', () => {
  test('a value and an async function are sent, the function called on every request', async () => {
    const { sent, fetch } = recorded();
    let tokens = 0;
    const orders = client(ordersDeps, {
      baseUrl: 'http://orders.test',
      fetch,
      headers: {
        'x-api-key': 'key-1',
        authorization: async () => {
          tokens += 1;
          return `Bearer t${tokens}`;
        },
      },
    });

    await orders.getOrder(params);
    await orders.getOrder(params);

    expect(sent.map((request) => request.headers.get('authorization'))).toEqual([
      'Bearer t1',
      'Bearer t2',
    ]);
    expect(sent.map((request) => request.headers.get('x-api-key'))).toEqual(['key-1', 'key-1']);
  });

  test('the call’s own value wins, and the function is then not called', async () => {
    const { sent, fetch } = recorded();
    let called = 0;
    const orders = client(ordersDeps, {
      baseUrl: 'http://orders.test',
      fetch,
      headers: {
        'x-api-key': 'key-1',
        authorization: () => {
          called += 1;
          return 'Bearer configured';
        },
      },
    });

    await orders.getOrder({
      ...params,
      headers: { 'x-api-key': 'key-2', authorization: 'Bearer passed' },
    });

    expect(sent[0]?.headers.get('x-api-key')).toBe('key-2');
    expect(sent[0]?.headers.get('authorization')).toBe('Bearer passed');
    expect(called).toBe(0);
  });

  test('a header is sent only to an Endpoint that declares it', async () => {
    const { sent, fetch } = recorded();
    let called = 0;
    const orders = client(ordersDeps, {
      baseUrl: 'http://orders.test',
      fetch,
      headers: {
        'x-api-key': 'key-1',
        authorization: () => {
          called += 1;
          return 'Bearer t';
        },
      },
    });

    await orders.ping();

    expect([...(sent[0]?.headers.keys() ?? [])]).toEqual([]);
    expect(called).toBe(0);
  });

  test('the headers a call passes are sent beside those given to client()', async () => {
    const { sent, fetch } = recorded();
    const orders = client(ordersDeps, {
      baseUrl: 'http://orders.test',
      fetch,
      headers: { authorization: 'Bearer configured' },
    });

    await orders.getOrder({ ...params, headers: { 'x-api-key': 'key-2' } });

    expect(sent[0]?.headers.get('x-api-key')).toBe('key-2');
    expect(sent[0]?.headers.get('authorization')).toBe('Bearer configured');
  });

  test('an aborted signal sends nothing and calls no header function', async () => {
    let called = 0;
    const orders = client(ordersDeps, {
      baseUrl: 'http://orders.test',
      fetch: recorded().fetch,
      headers: {
        'x-api-key': 'key-1',
        authorization: () => {
          called += 1;
          return 'Bearer t';
        },
      },
    });

    const outcome = await orders.getOrder(params, { signal: AbortSignal.abort() });

    expect(outcome).toMatchObject({
      kind: 'fault',
      committed: 'no',
      message: 'The request was aborted',
    });
    expect(called).toBe(0);
  });

  test('an already aborted signal is answered before a header function could throw', async () => {
    const orders = client(ordersDeps, {
      baseUrl: 'http://orders.test',
      fetch: recorded().fetch,
      headers: {
        'x-api-key': 'key-1',
        authorization: () => {
          throw new Error('no token');
        },
      },
    });

    const outcome = await orders.getOrder(params, { signal: AbortSignal.abort() });

    expect(outcome).toMatchObject({ kind: 'fault', committed: 'no' });
  });

  test('a header function that throws reaches the caller unchanged', async () => {
    const error = new Error('no token');
    const orders = client(ordersDeps, {
      baseUrl: 'http://orders.test',
      fetch: recorded().fetch,
      headers: {
        'x-api-key': 'key-1',
        authorization: () => {
          throw error;
        },
      },
    });

    const called = orders.getOrder(params);

    await expect(called).rejects.toBe(error);
  });
});
