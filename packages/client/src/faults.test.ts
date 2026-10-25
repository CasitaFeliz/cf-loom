import { createServer, type Server } from 'node:http';
import { type AddressInfo, createServer as createNetServer } from 'node:net';
import {
  type ContractPackage,
  defineContract,
  defineDependency,
  defineEndpoint,
  defineGroup,
  type Endpoint,
  type ProvidedStandardRejections,
} from '@cf-loom/contract';
import { exportedSnapshotOf, snapshotOf, validateContract } from '@cf-loom/contract/internal';
import { afterEach, describe, expect, test } from 'vitest';
import { z } from 'zod';
import { providedStandardRejections } from '../test/standard-rejections.ts';
import { client, type Happened, type Http, type InferredFault } from './index.ts';

const getOrder = defineEndpoint({
  name: 'getOrder',
  method: 'GET',
  path: '/orders/:orderId',
  visibility: 'public',
  description: 'One order',
  input: { params: z.object({ orderId: z.string() }) },
  success: { status: 200, body: z.object({ id: z.string() }) },
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

const orders = contractPackageOf({ getOrder }, defaultStandards);

const ordersDependency = defineDependency({ provider: orders, endpoints: [getOrder] });

const input = { params: { orderId: 'o-1' } };

/** A `fetch` that does what `answer` does, every time. */
function fetching(answer: () => Promise<Response>) {
  return (_request: Request) => answer();
}

/** A `fetch` that throws `error`, as a network failure does. */
function throwing(error: unknown) {
  return fetching(() => Promise.reject(error));
}

/** A `fetch` that answers a response with `status`, its body and headers as given. */
function answering(
  status: number,
  body: string | null = null,
  headers: Record<string, string> = {},
) {
  return fetching(async () => new Response(body, { status, headers }));
}

/** A `TypeError` as Node's `fetch` throws one, with the system error's code as its cause. */
function networkError(code: string): TypeError {
  return new TypeError('fetch failed', { cause: Object.assign(new Error(code), { code }) });
}

function ordersOver(fetch: Http) {
  return client(ordersDependency, { baseUrl: 'http://orders.test', fetch });
}

describe('row 1: no connection is committed no and retryable', () => {
  test.each(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT'])(
    'a TypeError caused by %s is no connection',
    async (code) => {
      const orders = ordersOver(throwing(networkError(code)));

      const outcome = await orders.getOrder(input);

      expect(outcome).toMatchObject({
        kind: 'fault',
        source: 'no-connection',
        committed: 'no',
        retryable: true,
        message: 'No connection to the Provider',
      });
    },
  );

  test('a call aborted before anything was sent is committed no, not retryable, with the signal’s reason as cause', async () => {
    let sent = 0;
    const orders = ordersOver(async () => {
      sent += 1;
      return Response.json({ id: 'o-1' });
    });
    const reason = new Error('Navigated away');

    const outcome = await orders.getOrder(input, { signal: AbortSignal.abort(reason) });

    expect(sent).toBe(0);
    expect(outcome).toEqual({
      kind: 'fault',
      source: 'aborted',
      committed: 'no',
      retryable: false,
      message: 'The request was aborted',
      cause: reason,
    });
  });

  test('a call whose signal timed out before anything was sent is committed no and retryable', async () => {
    let sent = 0;
    const orders = ordersOver(async () => {
      sent += 1;
      return Response.json({ id: 'o-1' });
    });
    const reason = new DOMException('Timed out', 'TimeoutError');

    const outcome = await orders.getOrder(input, { signal: AbortSignal.abort(reason) });

    expect(sent).toBe(0);
    expect(outcome).toEqual({
      kind: 'fault',
      source: 'timeout',
      committed: 'no',
      retryable: true,
      message: 'The request timed out',
      cause: reason,
    });
  });

  test('429 is committed no and retryable', async () => {
    const orders = ordersOver(answering(429));

    const outcome = await orders.getOrder(input);

    expect(outcome).toEqual({
      kind: 'fault',
      source: 'status',
      status: 429,
      committed: 'no',
      retryable: true,
      message: 'The Provider answered 429',
    });
  });
});

describe('row 2: a timeout or a lost connection after sending is committed unknown and retryable', () => {
  test('a TimeoutError thrown by fetch is a timeout, an AbortError an abort', async () => {
    const timeout = new DOMException('The operation timed out', 'TimeoutError');
    const abort = new DOMException('The operation was aborted', 'AbortError');

    const outcomes = [
      await ordersOver(throwing(timeout)).getOrder(input),
      await ordersOver(throwing(abort)).getOrder(input),
    ];

    expect(outcomes).toMatchObject([
      {
        source: 'timeout',
        committed: 'unknown',
        retryable: true,
        message: 'The request timed out',
      },
      {
        source: 'aborted',
        committed: 'unknown',
        retryable: false,
        message: 'The request was aborted',
      },
    ]);
  });

  test.each(['ECONNRESET', 'UND_ERR_SOCKET', 'ETIMEDOUT', 'ENETUNREACH', 'EHOSTUNREACH'])(
    'a TypeError caused by %s is a lost connection, which may have carried the request',
    async (code) => {
      const error = networkError(code);

      const outcome = await ordersOver(throwing(error)).getOrder(input);

      expect(outcome).toEqual({
        kind: 'fault',
        source: 'connection-failed',
        committed: 'unknown',
        retryable: true,
        message: 'The connection failed',
        cause: error,
      });
    },
  );

  test('UND_ERR_HEADERS_TIMEOUT thrown by fetch is a timeout', async () => {
    const error = networkError('UND_ERR_HEADERS_TIMEOUT');

    const outcome = await ordersOver(throwing(error)).getOrder(input);

    expect(outcome).toEqual({
      kind: 'fault',
      source: 'timeout',
      committed: 'unknown',
      retryable: true,
      message: 'The request timed out',
      cause: error,
    });
  });

  test('a call its Caller aborts while fetch runs is not retryable, and its cause is the signal’s reason', async () => {
    const controller = new AbortController();
    const orders = ordersOver(async () => {
      controller.abort();
      throw controller.signal.reason;
    });

    const outcome = await orders.getOrder(input, { signal: controller.signal });

    expect(outcome).toEqual({
      kind: 'fault',
      source: 'aborted',
      committed: 'unknown',
      retryable: false,
      message: 'The request was aborted',
      cause: controller.signal.reason,
    });
  });

  test('a signal aborted while fetch runs decides, whatever fetch throws', async () => {
    const controller = new AbortController();
    const orders = ordersOver(async () => {
      controller.abort(new DOMException('Timed out', 'TimeoutError'));
      throw new RangeError('anything at all');
    });

    const outcome = await orders.getOrder(input, { signal: controller.signal });

    expect(outcome).toMatchObject({
      source: 'timeout',
      committed: 'unknown',
      retryable: true,
      message: 'The request timed out',
    });
  });

  test('503 without an Envelope is committed unknown and retryable', async () => {
    const outcome = await ordersOver(answering(503, 'busy')).getOrder(input);

    expect(outcome).toEqual({
      kind: 'fault',
      source: 'status',
      status: 503,
      committed: 'unknown',
      retryable: true,
      message: 'The Provider answered 503',
    });
  });

  test('a body whose stream fails while it is read is committed unknown and retryable', async () => {
    const failure = new Error('socket hang up');
    const failing = () =>
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"'));
          controller.error(failure);
        },
      });
    const json = { 'content-type': 'application/json' };

    const outcomes = [
      await ordersOver(
        async () => new Response(failing(), { status: 200, headers: json }),
      ).getOrder(input),
      await ordersOver(
        async () => new Response(failing(), { status: 500, headers: json }),
      ).getOrder(input),
    ];

    expect(outcomes).toEqual(
      [200, 500].map((status) => ({
        kind: 'fault',
        source: 'unreadable-body',
        status,
        committed: 'unknown',
        retryable: true,
        message: 'The connection failed',
        cause: failure,
      })),
    );
  });

  test('UND_ERR_BODY_TIMEOUT while the body is read is a timeout, with the status that had arrived', async () => {
    const failure = networkError('UND_ERR_BODY_TIMEOUT');
    const stalled = new ReadableStream<Uint8Array>({
      start: (controller) => controller.error(failure),
    });
    const json = { 'content-type': 'application/json' };
    const orders = ordersOver(async () => new Response(stalled, { status: 200, headers: json }));

    const outcome = await orders.getOrder(input);

    expect(outcome).toEqual({
      kind: 'fault',
      source: 'timeout',
      status: 200,
      committed: 'unknown',
      retryable: true,
      message: 'The request timed out',
      cause: failure,
    });
  });
});

describe('row 2, more', () => {
  test('an abort with a reason of its own is an abort, and one named TimeoutError from any realm a timeout', async () => {
    const custom = new AbortController();
    const foreign = new AbortController();
    const orders = (controller: AbortController) =>
      ordersOver(async () => {
        controller.abort(controller === custom ? 'stop' : { name: 'TimeoutError' });
        throw new TypeError('fetch failed');
      });

    const outcomes = [
      await orders(custom).getOrder(input, { signal: custom.signal }),
      await orders(foreign).getOrder(input, { signal: foreign.signal }),
    ];

    expect(outcomes).toMatchObject([
      {
        source: 'aborted',
        committed: 'unknown',
        retryable: false,
        message: 'The request was aborted',
        cause: 'stop',
      },
      {
        source: 'timeout',
        committed: 'unknown',
        retryable: true,
        message: 'The request timed out',
      },
    ]);
  });

  test('an abort while the body is read is not retryable, with the status that had arrived', async () => {
    const controller = new AbortController();
    const stream = new ReadableStream<Uint8Array>(
      {
        pull: (streamController) => {
          controller.abort();
          streamController.error(new DOMException('Aborted', 'AbortError'));
        },
      },
      { highWaterMark: 0 },
    );
    const json = { 'content-type': 'application/json' };
    const orders = ordersOver(async () => new Response(stream, { status: 200, headers: json }));

    const outcome = await orders.getOrder(input, { signal: controller.signal });

    expect(outcome).toMatchObject({
      source: 'aborted',
      status: 200,
      committed: 'unknown',
      retryable: false,
      message: 'The request was aborted',
    });
  });

  test('Retry-After is kept on a Fault whose body failed while it was read', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => controller.error(new Error('reset')),
    });
    const headers = { 'content-type': 'application/json', 'retry-after': '30' };
    const orders = ordersOver(async () => new Response(stream, { status: 503, headers }));

    const outcome = await orders.getOrder(input);

    expect(outcome).toMatchObject({
      source: 'unreadable-body',
      status: 503,
      message: 'The connection failed',
      retryAfter: '30',
    });
  });
});

describe('row 3: any other failure is committed unknown and not retryable', () => {
  test('a TypeError caused by another system error, EPIPE, is not retryable', async () => {
    const outcome = await ordersOver(throwing(networkError('EPIPE'))).getOrder(input);

    expect(outcome).toMatchObject({
      source: 'connection-failed',
      committed: 'unknown',
      retryable: false,
    });
  });

  test('a declared Success status of another kind, a 204 on a 200 Endpoint, is inferred', async () => {
    const outcome = await ordersOver(answering(204)).getOrder(input);

    expect(outcome).toEqual({
      kind: 'fault',
      source: 'status',
      status: 204,
      committed: 'unknown',
      retryable: false,
      message: 'The Provider answered 204',
    });
  });

  test('an Envelope sent with a content type that is not JSON is no Envelope', async () => {
    const envelope = JSON.stringify({ rejection: { code: 'NOT_FOUND', message: 'Not found' } });

    const outcome = await ordersOver(
      answering(404, envelope, { 'content-type': 'text/plain' }),
    ).getOrder(input);

    expect(outcome).toMatchObject({
      kind: 'fault',
      source: 'status',
      status: 404,
      message: 'The Provider answered 404',
    });
  });

  test('a TypeError with no cause, as a browser throws for any network failure', async () => {
    const error = new TypeError('Failed to fetch');

    const outcome = await ordersOver(throwing(error)).getOrder(input);

    expect(outcome).toEqual({
      kind: 'fault',
      source: 'connection-failed',
      committed: 'unknown',
      retryable: false,
      message: 'The connection failed',
      cause: error,
    });
  });

  test.each([500, 502, 504])('%i without an Envelope', async (status) => {
    const outcome = await ordersOver(answering(status)).getOrder(input);

    expect(outcome).toEqual({
      kind: 'fault',
      source: 'status',
      status,
      committed: 'unknown',
      retryable: false,
      message: `The Provider answered ${status}`,
    });
  });

  test('a JSON 4xx that is no Envelope', async () => {
    const json = { 'content-type': 'application/json' };
    const outcome = await ordersOver(answering(400, '{"error":"bad"}', json)).getOrder(input);

    expect(outcome).toMatchObject({
      source: 'status',
      status: 400,
      committed: 'unknown',
      retryable: false,
    });
  });

  test('an HTML 502 from a gateway', async () => {
    const html = { 'content-type': 'text/html' };
    const page = '<html><body>Bad Gateway</body></html>';

    const outcome = await ordersOver(answering(502, page, html)).getOrder(input);

    expect(outcome).toEqual({
      kind: 'fault',
      source: 'status',
      status: 502,
      committed: 'unknown',
      retryable: false,
      message: 'The Provider answered 502',
    });
  });
});

describe('what is no network failure', () => {
  test('any other error fetch throws reaches the caller unchanged', async () => {
    const error = new RangeError('a bug in a fetch wrapper');

    const called = ordersOver(throwing(error)).getOrder(input);

    await expect(called).rejects.toBe(error);
  });

  test('a plain Error from fetch reaches the caller unchanged', async () => {
    const error = new Error('not a network failure');

    const called = ordersOver(throwing(error)).getOrder(input);

    await expect(called).rejects.toBe(error);
  });

  test('a thrown value that is no error reaches the caller unchanged', async () => {
    const called = ordersOver(throwing('text')).getOrder(input);

    await expect(called).rejects.toBe('text');
  });
});

describe('inferFault', () => {
  test('replaces the inference, receiving what happened and cf-loom’s inference', async () => {
    const received: [Happened, InferredFault][] = [];
    const orders = client(ordersDependency, {
      baseUrl: 'http://orders.test',
      fetch: answering(502),
      inferFault: (happened, inferred) => {
        received.push([happened, inferred]);
        return happened.kind === 'status' && happened.status === 502
          ? { committed: 'no', retryable: true }
          : undefined;
      },
    });

    const outcome = await orders.getOrder(input);

    expect(outcome).toEqual({
      kind: 'fault',
      source: 'status',
      status: 502,
      committed: 'no',
      retryable: true,
      message: 'The Provider answered 502',
    });
    expect(received).toEqual([
      [
        { kind: 'status', status: 502, headers: expect.any(Headers) },
        { committed: 'unknown', retryable: false },
      ],
    ]);
  });

  test('is given cf-loom’s own inference as its second argument', async () => {
    const inferred: InferredFault[] = [];
    const orders = client(ordersDependency, {
      baseUrl: 'http://orders.test',
      fetch: answering(429),
      inferFault: (_happened, ours) => {
        inferred.push(ours);
        return undefined;
      },
    });

    await orders.getOrder(input);

    expect(inferred).toEqual([{ committed: 'no', retryable: true }]);
  });

  test('returning undefined keeps cf-loom’s inference', async () => {
    const orders = client(ordersDependency, {
      baseUrl: 'http://orders.test',
      fetch: throwing(networkError('ECONNREFUSED')),
      inferFault: () => undefined,
    });

    const outcome = await orders.getOrder(input);

    expect(outcome).toMatchObject({ source: 'no-connection', committed: 'no', retryable: true });
  });

  test('is offered a refused connection as no-connection, with the error fetch threw', async () => {
    const error = networkError('ECONNREFUSED');
    const received: Happened[] = [];
    const orders = client(ordersDependency, {
      baseUrl: 'http://orders.test',
      fetch: throwing(error),
      inferFault: (happened) => {
        received.push(happened);
        return undefined;
      },
    });

    await orders.getOrder(input);

    expect(received).toEqual([{ kind: 'no-connection', error }]);
  });

  test('is offered a thrown error and a failed body, but never what was not sent', async () => {
    const kinds: Happened['kind'][] = [];
    const inferFault = (happened: Happened) => {
      kinds.push(happened.kind);
      return undefined;
    };
    const failing = new ReadableStream<Uint8Array>({
      start: (controller) => controller.error(new Error('reset')),
    });
    const json = { 'content-type': 'application/json' };
    const baseUrl = 'http://orders.test';

    await client(ordersDependency, {
      baseUrl,
      fetch: throwing(new TypeError('x')),
      inferFault,
    }).getOrder(input);
    await client(ordersDependency, {
      baseUrl,
      fetch: fetching(async () => new Response(failing, { status: 200, headers: json })),
      inferFault,
    }).getOrder(input);
    await client(ordersDependency, { baseUrl, fetch: answering(503), inferFault }).getOrder(input, {
      signal: AbortSignal.abort(),
    });

    expect(kinds).toEqual(['connection-failed', 'unreadable-body']);
  });
});

describe('Faults the Provider sent', () => {
  test('an Envelope Fault is kept as sent', async () => {
    const envelope = { fault: { committed: 'yes', retryable: false, message: 'Done, reply lost' } };
    const fetch = fetching(async () => Response.json(envelope, { status: 500 }));

    const outcome = await ordersOver(fetch).getOrder(input);

    expect(outcome).toEqual({
      kind: 'fault',
      source: 'provider',
      status: 500,
      committed: 'yes',
      retryable: false,
      message: 'Done, reply lost',
    });
  });

  test('a Fault code that is not reserved is dropped, a reserved one kept', async () => {
    const fault = { committed: 'no', retryable: false, message: 'Gone' };
    const unreserved = { fault: { ...fault, code: 'DB_DOWN' } };
    const reserved = { fault: { ...fault, code: 'RETIRED' } };

    const outcomes = [
      await ordersOver(fetching(async () => Response.json(unreserved, { status: 500 }))).getOrder(
        input,
      ),
      await ordersOver(fetching(async () => Response.json(reserved, { status: 410 }))).getOrder(
        input,
      ),
    ];

    expect(outcomes).toEqual([
      { kind: 'fault', source: 'provider', status: 500, ...fault },
      { kind: 'fault', source: 'provider', status: 410, code: 'RETIRED', ...fault },
    ]);
  });

  test('retryAfter is the Retry-After header of a 503, a 429 and an Envelope Fault', async () => {
    const retryAfter = { 'retry-after': '120' };
    const envelope = { fault: { committed: 'no', retryable: true, message: 'Busy' } };

    const outcomes = [
      await ordersOver(answering(503, null, retryAfter)).getOrder(input),
      await ordersOver(
        answering(429, null, { 'retry-after': 'Wed, 21 Oct 2026 07:28:00 GMT' }),
      ).getOrder(input),
      await ordersOver(
        fetching(async () => Response.json(envelope, { status: 503, headers: retryAfter })),
      ).getOrder(input),
    ];

    expect(outcomes.map((outcome) => outcome.kind === 'fault' && outcome.retryAfter)).toEqual([
      '120',
      'Wed, 21 Oct 2026 07:28:00 GMT',
      '120',
    ]);
  });
});

describe('the network rows against node:http', () => {
  const servers: Server[] = [];

  afterEach(() => {
    for (const server of servers.splice(0)) {
      server.closeAllConnections();
      server.close();
    }
  });

  /** A server on a free port, doing what `listener` does, and its base URL. */
  async function listening(listener: Parameters<typeof createServer>[1]): Promise<string> {
    const server = createServer(listener);
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    return `http://127.0.0.1:${port}`;
  }

  function ordersAt(baseUrl: string) {
    return client(ordersDependency, { baseUrl });
  }

  test('a refused connection is no connection', async () => {
    const baseUrl = await listening(() => undefined);
    const server = servers.pop();
    await new Promise((resolve) => server?.close(resolve));

    const outcome = await ordersAt(baseUrl).getOrder(input);

    expect(outcome).toMatchObject({
      source: 'no-connection',
      committed: 'no',
      retryable: true,
      message: 'No connection to the Provider',
    });
  });

  test('a host no DNS resolves is no connection', async () => {
    const outcome = await ordersAt('http://nowhere.invalid').getOrder(input);

    expect(outcome).toMatchObject({
      source: 'no-connection',
      committed: 'no',
      retryable: true,
      message: 'No connection to the Provider',
    });
  });

  test('AbortSignal.timeout against a server that never answers stays retryable', async () => {
    const baseUrl = await listening(() => undefined);

    const outcome = await ordersAt(baseUrl).getOrder(input, { signal: AbortSignal.timeout(50) });

    expect(outcome).toMatchObject({
      source: 'timeout',
      committed: 'unknown',
      retryable: true,
      message: 'The request timed out',
    });
  });

  test('an abort after the request reached the server is an abort', async () => {
    const controller = new AbortController();
    const baseUrl = await listening(() => controller.abort());

    const outcome = await ordersAt(baseUrl).getOrder(input, { signal: controller.signal });

    expect(outcome).toMatchObject({
      source: 'aborted',
      committed: 'unknown',
      retryable: false,
      message: 'The request was aborted',
    });
  });

  test('a socket destroyed after the request is a reset', async () => {
    const baseUrl = await listening((request) => request.socket.destroy());

    const outcome = await ordersAt(baseUrl).getOrder(input);

    expect(outcome).toMatchObject({
      source: 'connection-failed',
      committed: 'unknown',
      retryable: true,
      message: 'The connection failed',
    });
  });

  test('a body cut off while it is read is committed unknown and retryable', async () => {
    const baseUrl = await listening((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json', 'content-length': '100' });
      response.write('{"id":');
      setTimeout(() => response.socket?.destroy(), 20);
    });

    const outcome = await ordersAt(baseUrl).getOrder(input);

    expect(outcome).toMatchObject({
      source: 'unreadable-body',
      status: 200,
      committed: 'unknown',
      retryable: true,
      message: 'The connection failed',
    });
  });

  test('bytes that are no HTTP, from a real socket, are any other network failure', async () => {
    const socketServer = createNetServer((socket) => socket.end('garbage\r\n\r\n'));
    await new Promise<void>((resolve) => socketServer.listen(0, '127.0.0.1', resolve));
    const { port } = socketServer.address() as AddressInfo;

    const outcome = await ordersAt(`http://127.0.0.1:${port}`).getOrder(input);
    socketServer.close();

    expect(outcome).toMatchObject({
      source: 'connection-failed',
      committed: 'unknown',
      retryable: false,
      message: 'The connection failed',
    });
  });

  test('a 502 page cut off by a reset, seen after the stream failed, is still a Fault', async () => {
    const socketServer = createNetServer((socket) =>
      socket.once('data', () => {
        const head =
          'HTTP/1.1 502 Bad Gateway\r\ncontent-type: text/html\r\ncontent-length: 1000\r\n\r\n';
        socket.write(`${head}<html>`, () => socket.resetAndDestroy());
      }),
    );
    await new Promise<void>((resolve) => socketServer.listen(0, '127.0.0.1', resolve));
    const { port } = socketServer.address() as AddressInfo;
    const late = client(ordersDependency, {
      baseUrl: `http://127.0.0.1:${port}`,
      fetch: async (request) => {
        const response = await fetch(request);
        await new Promise((resolve) => setTimeout(resolve, 50));
        return response;
      },
    });

    const outcome = await late.getOrder(input);
    socketServer.close();

    expect(outcome).toMatchObject({
      kind: 'fault',
      source: 'status',
      status: 502,
      message: 'The Provider answered 502',
    });
  });
});
