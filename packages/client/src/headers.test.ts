import { getEventListeners } from 'node:events';
import { setImmediate as nextMacrotask } from 'node:timers/promises';
import {
  defineDependency,
  defineEndpoint,
  defineGroup,
  defineService,
  type Endpoint,
  type ProvidedStandardRejections,
  providedEndpoint,
} from '@cf-loom/contract';
import { providedSnapshotOf, snapshotOf, validateRoot } from '@cf-loom/contract/internal';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { type Exportable, providedEndpointsOf } from '../test/provided.ts';
import { aRootPackage } from '../test/root-package.ts';
import { providedStandardRejections } from '../test/standard-rejections.ts';
import { type CallOptions, client } from './index.ts';

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

const createOrder = defineEndpoint({
  name: 'createOrder',
  method: 'POST',
  path: '/orders',
  visibility: 'public',
  description: 'A new order',
  input: {
    headers: z.object({ 'x-api-key': z.string() }),
    body: z.object({ quantity: z.int() }),
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
  const Endpoints extends Readonly<Record<string, Exportable>>,
  const Standards extends ProvidedStandardRejections,
>(endpoints: Endpoints, standardRejections: Standards, declared = Object.values(endpoints)) {
  const listed = declared as unknown as [Endpoint];
  const group = defineGroup({ name: 'orders', description: 'Orders', endpoints: listed });
  const root = defineService({ name: 'orders-service', groups: [group] });
  const rootPackage = aRootPackage(root, { packageName: 'orders-service' });
  const validated = validateRoot(root, rootPackage);
  if (validated.kind !== 'valid') {
    throw new Error(`The fixture is invalid: ${JSON.stringify(validated.failures)}`);
  }
  const snapshot = snapshotOf(validated);
  if (snapshot.kind !== 'service') {
    throw new Error('The fixture is no Service');
  }
  const name = 'orders-service';
  const provided = providedEndpointsOf({ name, standardRejections }, endpoints, snapshot);
  return {
    name,
    endpoints: provided,
    events: {},
    standardRejections,
  };
}

const defaultStandards = providedStandardRejections();

const orders = contractPackageOf({ getOrder, createOrder, ping }, defaultStandards);

const ordersDependency = defineDependency({
  endpoints: [orders.endpoints.getOrder, orders.endpoints.createOrder, orders.endpoints.ping],
});

/** Every request a client sent, as its `fetch` received it. */
function recorded() {
  const sent: Request[] = [];
  const fetch = async (request: Request) => {
    sent.push(request);
    return new Response(null, { status: 204 });
  };
  return { sent, fetch };
}

const params = { params: { orderId: 'o-1' } };

describe('headers given to client()', () => {
  test('a value and an async function are sent, the function called on every request', async () => {
    const { sent, fetch } = recorded();
    let tokens = 0;
    const orders = client(ordersDependency, {
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
    const orders = client(ordersDependency, {
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
    const orders = client(ordersDependency, {
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
    const orders = client(ordersDependency, {
      baseUrl: 'http://orders.test',
      fetch,
      headers: { authorization: 'Bearer configured' },
    });

    await orders.getOrder({ ...params, headers: { 'x-api-key': 'key-2' } });

    expect(sent[0]?.headers.get('x-api-key')).toBe('key-2');
    expect(sent[0]?.headers.get('authorization')).toBe('Bearer configured');
  });

  test('a header given to client() under a name every object already has is sent when the call passes headers without it', async () => {
    const declared = defineEndpoint({
      name: 'trace',
      method: 'GET',
      path: '/trace',
      visibility: 'public',
      description: 'Traced',
      input: { headers: z.object({ 'x-trace': z.string().optional() }) },
      success: { status: 204 },
    });
    const written = contractPackageOf({ trace: declared }, defaultStandards);
    const cut = JSON.stringify(providedSnapshotOf(written.endpoints.trace));
    const named = providedEndpoint(
      { name: 'orders-service', standardRejections: defaultStandards },
      {
        name: 'trace',
        method: 'GET',
        path: '/trace',
        visibility: 'public',
        description: 'Traced',
        input: { headers: z.object({ constructor: z.string().optional() }) },
        success: { status: 204 },
      },
      JSON.parse(cut.replaceAll('x-trace', 'constructor')),
    );
    const dependency = defineDependency({ endpoints: [named] });
    const { sent, fetch } = recorded();
    const traced = client(dependency, {
      baseUrl: 'http://orders.test',
      fetch,
      headers: { constructor: 'configured' },
    });

    await traced.trace({ headers: {} } as never);

    expect(sent[0]?.headers.get('constructor')).toBe('configured');
  });

  test('an aborted signal sends nothing and calls no header function', async () => {
    let called = 0;
    const orders = client(ordersDependency, {
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
      source: 'aborted',
      committed: 'no',
      message: 'The request was aborted',
    });
    expect(called).toBe(0);
  });

  test('an already aborted signal is answered before a header function could throw', async () => {
    const orders = client(ordersDependency, {
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
    const orders = client(ordersDependency, {
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

/** A client whose `authorization` is `refresh`, and whose `fetch` records what it is sent. */
function refreshing(refresh: (call: CallOptions) => string | Promise<string>) {
  const { sent, fetch } = recorded();
  const orders = client(ordersDependency, {
    baseUrl: 'http://orders.test',
    fetch,
    headers: { 'x-api-key': 'key-1', authorization: refresh },
  });
  return { orders, sent };
}

describe('a header function', () => {
  test('receives the call’s signal', async () => {
    const controller = new AbortController();
    const received: CallOptions[] = [];
    const { orders } = refreshing((call) => {
      received.push(call);
      return 'Bearer t';
    });

    await orders.getOrder(params, { signal: controller.signal });

    expect(received).toHaveLength(1);
    expect(received[0]?.signal).toBe(controller.signal);
  });

  test('receives the options the call was given, as they are', async () => {
    const options: CallOptions = { signal: new AbortController().signal };
    const received: CallOptions[] = [];
    const { orders } = refreshing((call) => {
      received.push(call);
      return 'Bearer t';
    });

    await orders.getOrder(params, options);

    expect(received[0]).toBe(options);
  });

  test('of a call with no signal receives none', async () => {
    const received: CallOptions[] = [];
    const { orders } = refreshing((call) => {
      received.push(call);
      return 'Bearer t';
    });

    await orders.getOrder(params);

    expect(received).toStrictEqual([{}]);
  });

  test('whose call is aborted while it runs gets the not-sent Fault at once, and nothing is sent', async () => {
    const controller = new AbortController();
    const refreshed = Promise.withResolvers<string>();
    const { orders, sent } = refreshing(() => refreshed.promise);

    const calling = orders.getOrder(params, { signal: controller.signal });
    controller.abort();
    const outcome = await calling;
    refreshed.resolve('Bearer late');
    await nextMacrotask();

    expect(outcome).toMatchObject({
      kind: 'fault',
      source: 'aborted',
      committed: 'no',
      retryable: false,
    });
    expect(sent).toEqual([]);
  });

  test('that never settles gets a retryable timeout Fault when the call’s signal times out', async () => {
    const { orders, sent } = refreshing(() => new Promise<string>(() => undefined));

    const outcome = await orders.getOrder(params, { signal: AbortSignal.timeout(20) });

    expect(outcome).toMatchObject({
      kind: 'fault',
      source: 'timeout',
      committed: 'no',
      retryable: true,
    });
    expect(sent).toEqual([]);
  });

  test('that rejects after its call was aborted raises no unhandled rejection', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      unhandled.push(reason);
    };
    process.on('unhandledRejection', onUnhandled);
    const controller = new AbortController();
    const refreshed = Promise.withResolvers<string>();
    const { orders } = refreshing(() => refreshed.promise);

    try {
      const calling = orders.getOrder(params, { signal: controller.signal });
      controller.abort();
      await calling;
      refreshed.reject(new Error('the refresh failed late'));
      await nextMacrotask();
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }

    expect(unhandled).toEqual([]);
  });

  test('that rejects with an AbortError of its own once the signal is aborted gets the not-sent Fault, not its error', async () => {
    const controller = new AbortController();
    const { orders, sent } = refreshing(
      ({ signal }) =>
        new Promise<string>((_resolve, reject) => {
          signal?.addEventListener('abort', () => {
            reject(new DOMException('The refresh stopped', 'AbortError'));
          });
        }),
    );

    const calling = orders.getOrder(params, { signal: controller.signal });
    controller.abort();
    const outcome = await calling;

    expect(outcome).toMatchObject({ kind: 'fault', source: 'aborted', committed: 'no' });
    expect(sent).toEqual([]);
  });

  test('that rejects while the signal is not aborted reaches the caller unchanged', async () => {
    const error = new Error('no token');
    const { orders, sent } = refreshing(() => Promise.reject(error));

    const called = orders.getOrder(params, { signal: new AbortController().signal });

    await expect(called).rejects.toBe(error);
    expect(sent).toEqual([]);
  });

  test('that aborts its own call and returns is answered with the not-sent Fault, and the next one is not called', async () => {
    const controller = new AbortController();
    const { sent, fetch } = recorded();
    let called = 0;
    const orders = client(ordersDependency, {
      baseUrl: 'http://orders.test',
      fetch,
      headers: {
        'x-api-key': () => {
          controller.abort();
          return 'key-1';
        },
        authorization: () => {
          called += 1;
          return new Promise<string>(() => undefined);
        },
      },
    });

    const outcome = await orders.getOrder(params, { signal: controller.signal });

    expect(outcome).toMatchObject({ kind: 'fault', source: 'aborted', committed: 'no' });
    expect(called).toBe(0);
    expect(sent).toEqual([]);
  });

  test('is not called once the signal was aborted in a microtask after the one before returned', async () => {
    const controller = new AbortController();
    const { sent, fetch } = recorded();
    let called = 0;
    const orders = client(ordersDependency, {
      baseUrl: 'http://orders.test',
      fetch,
      headers: {
        'x-api-key': () => {
          queueMicrotask(() => controller.abort());
          return 'key-1';
        },
        authorization: () => {
          called += 1;
          return 'Bearer t';
        },
      },
    });

    const outcome = await orders.getOrder(params, { signal: controller.signal });

    expect(outcome).toMatchObject({ kind: 'fault', source: 'aborted', committed: 'no' });
    expect(called).toBe(0);
    expect(sent).toEqual([]);
  });

  test('of a call refused for its Input leaves no abort listener on a long-lived signal', async () => {
    const controller = new AbortController();
    const { orders } = refreshing(async () => 'Bearer t');
    const refused = { params: { orderId: 1 } } as never;

    for (let call = 0; call < 20; call += 1) {
      await orders.getOrder(refused, { signal: controller.signal });
    }

    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0);
  });
});

describe('a fetch wrapper', () => {
  test('setting a header on the Request keeps every header the client set', async () => {
    const { sent, fetch: recording } = recorded();
    const orders = client(ordersDependency, {
      baseUrl: 'http://orders.test',
      headers: { 'x-api-key': 'key-1' },
      fetch: (request) => {
        request.headers.set('traceparent', '00-trace');
        return recording(request);
      },
    });

    await orders.createOrder({ body: { quantity: 2 } });

    expect(Object.fromEntries(sent[0]?.headers ?? [])).toEqual({
      'content-type': 'application/json; charset=utf-8',
      'x-api-key': 'key-1',
      traceparent: '00-trace',
    });
  });
});
