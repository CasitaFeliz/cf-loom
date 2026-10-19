import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  type ContractPackage,
  defineDependencies,
  defineEndpoint,
} from '@casitafeliz/loom-contract';
import { afterEach, describe, expect, test } from 'vitest';
import { z } from 'zod';
import { client, type Happened, type InferredFault } from './index.ts';

const getOrder = defineEndpoint({
  name: 'getOrder',
  method: 'GET',
  path: '/orders/:orderId',
  visibility: 'public',
  description: 'One order',
  input: { params: z.object({ orderId: z.string() }) },
  success: { status: 200, body: z.object({ id: z.string() }) },
});

const orders = {
  name: 'orders-service',
  version: '1.0.0',
  endpoints: { getOrder },
  events: {},
  standardRejections: {
    invalidInput: { code: 'INVALID_INPUT', status: 400, message: 'Invalid input' },
    notFound: { code: 'NOT_FOUND', status: 404, message: 'Not found' },
    notImplemented: { code: 'NOT_IMPLEMENTED', status: 501, message: 'Not implemented' },
  },
} as const satisfies ContractPackage;

const ordersDeps = defineDependencies(orders, { endpoints: [getOrder] });

const input = { params: { orderId: 'o-1' } };

/** A `fetch` that does what `answer` does, every time. */
function fetching(answer: () => Promise<Response>) {
  return (_url: string, _init: RequestInit) => answer();
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

function ordersOver(fetch: (url: string, init: RequestInit) => Promise<Response>) {
  return client(ordersDeps, { baseUrl: 'http://orders.test', fetch });
}

describe('row 1: no connection is committed no and retryable', () => {
  test.each([
    'ECONNREFUSED',
    'ENOTFOUND',
    'EAI_AGAIN',
    'ENETUNREACH',
    'EHOSTUNREACH',
    'ETIMEDOUT',
    'UND_ERR_CONNECT_TIMEOUT',
  ])('a TypeError caused by %s is no connection', async (code) => {
    const orders = ordersOver(throwing(networkError(code)));

    const outcome = await orders.getOrder(input);

    expect(outcome).toMatchObject({
      kind: 'fault',
      committed: 'no',
      retryable: true,
      message: 'No connection to the Provider',
    });
  });

  test('an aborted signal sends nothing, and the Fault is committed no', async () => {
    let sent = 0;
    const orders = ordersOver(async () => {
      sent += 1;
      return Response.json({ id: 'o-1' });
    });
    const aborted = AbortSignal.abort();
    const timedOut = AbortSignal.abort(new DOMException('Timed out', 'TimeoutError'));

    const outcomes = [
      await orders.getOrder(input, { signal: aborted }),
      await orders.getOrder(input, { signal: timedOut }),
    ];

    expect(sent).toBe(0);
    expect(outcomes).toEqual([
      { kind: 'fault', committed: 'no', retryable: true, message: 'The request was aborted' },
      { kind: 'fault', committed: 'no', retryable: true, message: 'The request timed out' },
    ]);
  });

  test('429 is committed no and retryable', async () => {
    const orders = ordersOver(answering(429));

    const outcome = await orders.getOrder(input);

    expect(outcome).toEqual({
      kind: 'fault',
      committed: 'no',
      retryable: true,
      message: 'The Provider answered 429',
    });
  });
});

describe('row 2: a timeout, a reset or an abort after sending is committed unknown and retryable', () => {
  test('a TimeoutError thrown by fetch is a timeout, an AbortError an abort', async () => {
    const timeout = new DOMException('The operation timed out', 'TimeoutError');
    const abort = new DOMException('The operation was aborted', 'AbortError');

    const outcomes = [
      await ordersOver(throwing(timeout)).getOrder(input),
      await ordersOver(throwing(abort)).getOrder(input),
    ];

    expect(outcomes).toMatchObject([
      { committed: 'unknown', retryable: true, message: 'The request timed out' },
      { committed: 'unknown', retryable: true, message: 'The request was aborted' },
    ]);
  });

  test.each(['ECONNRESET', 'UND_ERR_SOCKET'])(
    'a TypeError caused by %s is a reset',
    async (code) => {
      const outcome = await ordersOver(throwing(networkError(code))).getOrder(input);

      expect(outcome).toMatchObject({
        committed: 'unknown',
        retryable: true,
        message: 'The connection failed',
      });
    },
  );

  test('a signal aborted while fetch runs decides, whatever fetch throws', async () => {
    const controller = new AbortController();
    const orders = ordersOver(async () => {
      controller.abort(new DOMException('Timed out', 'TimeoutError'));
      throw new RangeError('anything at all');
    });

    const outcome = await orders.getOrder(input, { signal: controller.signal });

    expect(outcome).toMatchObject({
      committed: 'unknown',
      retryable: true,
      message: 'The request timed out',
    });
  });

  test('503 without an Envelope is committed unknown and retryable', async () => {
    const outcome = await ordersOver(answering(503, 'busy')).getOrder(input);

    expect(outcome).toEqual({
      kind: 'fault',
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

    for (const outcome of outcomes) {
      expect(outcome).toEqual({
        kind: 'fault',
        committed: 'unknown',
        retryable: true,
        message: 'The connection failed',
        cause: failure,
      });
    }
  });
});

describe('row 3: any other failure is committed unknown and not retryable', () => {
  test('a TypeError with no cause, as a browser throws for any network failure', async () => {
    const error = new TypeError('Failed to fetch');

    const outcome = await ordersOver(throwing(error)).getOrder(input);

    expect(outcome).toEqual({
      kind: 'fault',
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
      committed: 'unknown',
      retryable: false,
      message: `The Provider answered ${status}`,
    });
  });

  test('a JSON 4xx that is no Envelope', async () => {
    const json = { 'content-type': 'application/json' };
    const outcome = await ordersOver(answering(400, '{"error":"bad"}', json)).getOrder(input);

    expect(outcome).toMatchObject({ committed: 'unknown', retryable: false });
  });

  test('an HTML 502 from a gateway', async () => {
    const html = { 'content-type': 'text/html' };
    const page = '<html><body>Bad Gateway</body></html>';

    const outcome = await ordersOver(answering(502, page, html)).getOrder(input);

    expect(outcome).toMatchObject({
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

  test('a thrown value that is no error reaches the caller unchanged', async () => {
    const called = ordersOver(throwing('text')).getOrder(input);

    await expect(called).rejects.toBe('text');
  });
});

describe('inferFault', () => {
  test('replaces the inference, receiving what happened and cf-loom’s inference', async () => {
    const received: [Happened, InferredFault][] = [];
    const orders = client(ordersDeps, {
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

  test('returning undefined keeps cf-loom’s inference', async () => {
    const orders = client(ordersDeps, {
      baseUrl: 'http://orders.test',
      fetch: throwing(networkError('ECONNREFUSED')),
      inferFault: () => undefined,
    });

    const outcome = await orders.getOrder(input);

    expect(outcome).toMatchObject({ committed: 'no', retryable: true });
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

    await client(ordersDeps, { baseUrl, fetch: throwing(new TypeError('x')), inferFault }).getOrder(
      input,
    );
    await client(ordersDeps, {
      baseUrl,
      fetch: fetching(async () => new Response(failing, { status: 200, headers: json })),
      inferFault,
    }).getOrder(input);
    await client(ordersDeps, { baseUrl, fetch: answering(503), inferFault }).getOrder(input, {
      signal: AbortSignal.abort(),
    });

    expect(kinds).toEqual(['thrown', 'unreadable-body']);
  });
});

describe('Faults the Provider sent', () => {
  test('an Envelope Fault is kept as sent', async () => {
    const envelope = { fault: { committed: 'yes', retryable: false, message: 'Done, reply lost' } };
    const fetch = fetching(async () => Response.json(envelope, { status: 500 }));

    const outcome = await ordersOver(fetch).getOrder(input);

    expect(outcome).toEqual({
      kind: 'fault',
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
      { kind: 'fault', ...fault },
      { kind: 'fault', code: 'RETIRED', ...fault },
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
    return client(ordersDeps, { baseUrl });
  }

  test('a refused connection is no connection', async () => {
    const baseUrl = await listening(() => undefined);
    const server = servers.pop();
    await new Promise((resolve) => server?.close(resolve));

    const outcome = await ordersAt(baseUrl).getOrder(input);

    expect(outcome).toMatchObject({
      committed: 'no',
      retryable: true,
      message: 'No connection to the Provider',
    });
  });

  test('a host no DNS resolves is no connection', async () => {
    const outcome = await ordersAt('http://nowhere.invalid').getOrder(input);

    expect(outcome).toMatchObject({
      committed: 'no',
      retryable: true,
      message: 'No connection to the Provider',
    });
  });

  test('AbortSignal.timeout against a server that never answers is a timeout', async () => {
    const baseUrl = await listening(() => undefined);

    const outcome = await ordersAt(baseUrl).getOrder(input, { signal: AbortSignal.timeout(50) });

    expect(outcome).toMatchObject({
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
      committed: 'unknown',
      retryable: true,
      message: 'The request was aborted',
    });
  });

  test('a socket destroyed after the request is a reset', async () => {
    const baseUrl = await listening((request) => request.socket.destroy());

    const outcome = await ordersAt(baseUrl).getOrder(input);

    expect(outcome).toMatchObject({
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
      committed: 'unknown',
      retryable: true,
      message: 'The connection failed',
    });
  });
});
