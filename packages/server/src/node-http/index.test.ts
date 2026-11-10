import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { type AddressInfo, connect } from 'node:net';
import { PassThrough, Readable } from 'node:stream';
import { inspect } from 'node:util';
import { defineEndpoint, defineGroup, defineGuard, defineService } from '@cf-loom/contract';
import { admit, handle, success } from '@cf-loom/handlers';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { z } from 'zod';
import { collected, heldOf } from '../../../contract/test/collected.ts';
import { printedBy } from '../../../contract/test/printed.ts';
import {
  bodyOf,
  callerSocket,
  closeCallerSockets,
  raw,
  rawFor,
  statusLineOf,
  statusLinesOf,
} from '../../test/raw-http.ts';
import { type AnsweredRequest, type Http, serve } from '../index.ts';
import { nodeHttp, nodeListener } from './index.ts';

const apiKey = defineGuard({
  name: 'apiKey',
  description: 'A key per Caller',
  demands: { headers: z.object({ 'x-api-key': z.string() }) },
  context: z.object({ callerId: z.string() }),
});

const createOrder = defineEndpoint({
  name: 'createOrder',
  method: 'POST',
  path: '/orders',
  visibility: 'public',
  description: 'A new order',
  guards: [apiKey],
  input: { body: z.object({ quantity: z.int() }) },
  success: {
    status: 201,
    headers: z.object({ 'x-order-count': z.int() }),
    body: z.object({ quantity: z.int(), by: z.string() }),
  },
});

const noteOrder = defineEndpoint({
  name: 'noteOrder',
  method: 'POST',
  path: '/notes',
  visibility: 'public',
  description: 'A note on an order, with no Guard',
  input: { body: z.object({ text: z.string() }) },
  success: { status: 200, body: z.object({ text: z.string() }) },
});

const getOrder = defineEndpoint({
  name: 'getOrder',
  method: 'GET',
  path: '/orders/:orderId',
  visibility: 'public',
  description: 'One order',
  input: { params: z.object({ orderId: z.string() }) },
  success: { status: 200, body: z.object({ id: z.string() }) },
});

const greet = defineEndpoint({
  name: 'greet',
  method: 'GET',
  path: '/greet',
  visibility: 'public',
  description: 'Greets by name',
  input: { query: z.object({ name: z.string() }) },
  success: { status: 204, headers: z.object({ 'x-greeted': z.string() }) },
});

const contract = defineService({
  name: 'orders-service',
  groups: [
    defineGroup({
      name: 'orders',
      description: 'Orders',
      endpoints: [createOrder, noteOrder, getOrder, greet],
    }),
  ],
});

const handlers = {
  endpoints: {
    createOrder: handle(createOrder, ({ body }, { context: { apiKey: caller } }) =>
      success(createOrder, {
        headers: { 'x-order-count': 1 },
        body: { ...body, by: caller.callerId },
      }),
    ),
    noteOrder: handle(noteOrder, ({ body }) => success(noteOrder, body)),
    getOrder: handle(getOrder, ({ params }) => success(getOrder, { id: params.orderId })),
    greet: handle(greet, ({ query }) => success(greet, { headers: { 'x-greeted': query.name } })),
  },
  guards: {
    apiKey: handle(apiKey, ({ headers }) => admit(apiKey, { callerId: headers['x-api-key'] })),
  },
};

const servers: ReturnType<typeof nodeHttp>[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  closeCallerSockets();
  for (const server of servers.splice(0)) {
    server.close();
  }
});

/** A node:http server over nodeListener that keeps each response it was handed, to look at what is left on it. */
function serverKeeping(http: Http) {
  const responses: ServerResponse[] = [];
  const listener = nodeListener(http);
  const server = createServer((incoming, outgoing) => {
    responses.push(outgoing);
    listener(incoming, outgoing);
  });
  return { server, responses };
}

/** The Service listening on a free port, and the URL it answers at. */
async function listening(server = nodeHttp(serve(contract, handlers, {}))): Promise<string> {
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

/**
 * What `nodeListener` answers for an incoming message `node:http` would never parse itself, given
 * to it directly with a recording response.
 */
async function listenedTo(sent: { readonly method: string; readonly url: string }) {
  const incoming = Object.assign(Readable.from([]), {
    ...sent,
    headers: { host: 'test' },
    rawHeaders: ['Host', 'test'],
  });
  const written = new PassThrough();
  const outgoing = Object.assign(written, {
    req: incoming,
    statusCode: 0,
    appendHeader: () => outgoing,
    setHeader: () => outgoing,
    removeHeader: () => outgoing,
    writeHead: () => outgoing,
  });
  const finished = new Promise((resolve) => written.on('finish', resolve));
  nodeListener(serve(contract, handlers, {}))(
    incoming as unknown as IncomingMessage,
    outgoing as unknown as ServerResponse,
  );
  await finished;
  return { status: outgoing.statusCode, body: String(written.read() ?? '') };
}

describe('nodeHttp', () => {
  test('a POST with a JSON body and a demanded header answers the Success through node:http', async () => {
    const url = await listening();

    const response = await fetch(`${url}/orders`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': 'c-1' },
      body: JSON.stringify({ quantity: 2 }),
    });

    expect(response.status).toBe(201);
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(response.headers.get('x-order-count')).toBe('1');
    expect(await response.json()).toEqual({ quantity: 2, by: 'c-1' });
  });

  test('a GET to an undeclared path answers NO_SUCH_ENDPOINT', async () => {
    const url = await listening();

    const response = await fetch(`${url}/customers`);

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ fault: { code: 'NO_SUCH_ENDPOINT' } });
  });

  test('a body larger than maxBodyBytes is BODY_TOO_LARGE over a real socket', async () => {
    const url = await listening(nodeHttp(serve(contract, handlers, { maxBodyBytes: 16 })));

    const response = await fetch(`${url}/orders`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': 'c-1' },
      body: JSON.stringify({ quantity: 2, padding: 'x'.repeat(1000) }),
    });

    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ fault: { code: 'BODY_TOO_LARGE' } });
  });

  test('a path that starts with // is a path, never a host', async () => {
    const url = await listening();

    const answers = [
      await raw(url, 'GET //orders/o-1 HTTP/1.1\r\nHost: test\r\nConnection: close\r\n\r\n'),
      await raw(url, 'GET //evil/orders/mine HTTP/1.1\r\nHost: test\r\nConnection: close\r\n\r\n'),
    ];

    expect(answers.map(statusLineOf)).toEqual(['HTTP/1.1 404 Not Found', 'HTTP/1.1 404 Not Found']);
    expect(answers.map((answer) => JSON.parse(bodyOf(answer)).fault.code)).toEqual([
      'NO_SUCH_ENDPOINT',
      'NO_SUCH_ENDPOINT',
    ]);
  });

  test('an absolute-form target routes on its path and query', async () => {
    const url = await listening();

    const answer = await raw(
      url,
      'GET http://other/orders/o-1?x=1 HTTP/1.1\r\nHost: test\r\nConnection: close\r\n\r\n',
    );

    expect(statusLineOf(answer)).toBe('HTTP/1.1 200 OK');
    expect(JSON.parse(bodyOf(answer))).toEqual({ id: 'o-1' });
  });

  test('an asterisk or authority-form target is answered 400', async () => {
    const url = await listening();

    const answers = [
      await raw(url, 'OPTIONS * HTTP/1.1\r\nHost: test\r\nConnection: close\r\n\r\n'),
      await raw(url, 'GET test:80 HTTP/1.1\r\nHost: test\r\nConnection: close\r\n\r\n'),
    ];

    expect(answers.map(statusLineOf)).toEqual([
      'HTTP/1.1 400 Bad Request',
      'HTTP/1.1 400 Bad Request',
    ]);
  });

  test('TRACE, which a web-standard Request refuses, answers NO_SUCH_ENDPOINT and the server keeps serving', async () => {
    const url = await listening();

    const traced = await raw(
      url,
      'TRACE /orders HTTP/1.1\r\nHost: test\r\nConnection: close\r\n\r\n',
    );
    const after = await fetch(`${url}/orders/o-1`);

    expect(statusLineOf(traced)).toBe('HTTP/1.1 404 Not Found');
    expect(JSON.parse(bodyOf(traced))).toMatchObject({ fault: { code: 'NO_SUCH_ENDPOINT' } });
    expect(after.status).toBe(200);
  });

  test.each(['CONNECT', 'TRACE', 'TRACK', 'track'])(
    'nodeListener answers %s, a method a Request refuses, with NO_SUCH_ENDPOINT',
    async (method) => {
      const answer = await listenedTo({ method, url: '/orders' });

      expect(answer.status).toBe(404);
      expect(JSON.parse(answer.body)).toMatchObject({ fault: { code: 'NO_SUCH_ENDPOINT' } });
    },
  );

  test('nodeListener answers an absolute target of another scheme with 400', async () => {
    const answer = await listenedTo({ method: 'GET', url: 'ftp://test/orders/o-1' });

    expect(answer.status).toBe(400);
  });

  test('a request without a Host header is answered 400', async () => {
    const own = createServer(
      { requireHostHeader: false },
      nodeListener(serve(contract, handlers, {})),
    );
    const url = await listening(own);

    const answer = await raw(url, 'GET /orders/o-1 HTTP/1.1\r\nConnection: close\r\n\r\n');

    expect(statusLineOf(answer)).toBe('HTTP/1.1 400 Bad Request');
  });

  test.each(['not a host', 'x/orders', 'x?', 'x#', '', 'x\\orders', 'x:80/orders', 'user@x'])(
    'a Host header that is no bare host and port, %j, is answered 400 and never routes',
    async (host) => {
      const url = await listening();

      const answer = await raw(
        url,
        `GET /mine HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`,
      );

      expect(statusLineOf(answer)).toBe('HTTP/1.1 400 Bad Request');
    },
  );

  test('a Host header with a port routes on the path', async () => {
    const url = await listening();

    const answer = await raw(
      url,
      'GET /orders/o-1 HTTP/1.1\r\nHost: test:8080\r\nConnection: close\r\n\r\n',
    );

    expect(statusLineOf(answer)).toBe('HTTP/1.1 200 OK');
  });

  test('a response to HEAD carries no body', async () => {
    const url = await listening(nodeHttp(async () => Response.json({ a: 1 })));

    const answer = await raw(
      url,
      'HEAD /orders/o-1 HTTP/1.1\r\nHost: test\r\nConnection: close\r\n\r\n',
    );

    expect(statusLineOf(answer)).toBe('HTTP/1.1 200 OK');
    expect(answer.toLowerCase()).toContain('content-type: application/json');
    expect(bodyOf(answer)).toBe('');
  });

  test('a body whose Response states its length is sent with it, and one that states none is chunked', async () => {
    const bodies: Http = async (request) => {
      const stated = new URL(request.url).pathname === '/stated';
      return new Response('{"a":1}', { headers: stated ? { 'content-length': '7' } : {} });
    };
    const url = await listening(nodeHttp(bodies));

    const stated = await raw(
      url,
      'GET /stated HTTP/1.1\r\nHost: test\r\nConnection: close\r\n\r\n',
    );
    const unstated = await raw(
      url,
      'GET /other HTTP/1.1\r\nHost: test\r\nConnection: close\r\n\r\n',
    );

    const [statedHead = ''] = stated.split('\r\n\r\n');
    const [unstatedHead = ''] = unstated.split('\r\n\r\n');
    expect(statedHead).toMatch(/^content-length: 7$/im);
    expect(statedHead).not.toMatch(/^transfer-encoding:/im);
    expect(unstatedHead).toMatch(/^transfer-encoding: chunked$/im);
    expect(unstatedHead).not.toMatch(/^content-length:/im);
    expect([bodyOf(stated), bodyOf(unstated)]).toEqual(['{"a":1}', '{"a":1}']);
  });

  test('a stated length that does not match the body’s bytes destroys the socket, and the server keeps serving', async () => {
    const mismatched: Http = async (request) => {
      if (new URL(request.url).pathname === '/short') {
        return new Response('{"a":1}', { headers: { 'content-length': '3' } });
      }
      return new Response(null, { status: 204 });
    };
    const url = await listening(nodeHttp(mismatched));

    const answer = await raw(url, 'GET /short HTTP/1.1\r\nHost: test\r\nConnection: close\r\n\r\n');
    const after = await fetch(`${url}/ok`);

    expect(statusLinesOf(answer)).toEqual([]);
    expect(after.status).toBe(204);
  });

  test('a Response with a header value Node refuses destroys the socket, and the server keeps serving', async () => {
    const refusing: Http = async (request) => {
      if (new URL(request.url).pathname === '/bad') {
        return new Response('{}', { headers: { 'x-bad': 'a\u0001b' } });
      }
      return new Response(null, { status: 204 });
    };
    const url = await listening(nodeHttp(refusing));

    const bad = await raw(url, 'GET /bad HTTP/1.1\r\nHost: test\r\nConnection: close\r\n\r\n');
    const after = await fetch(`${url}/ok`);

    expect(statusLinesOf(bad)).toEqual([]);
    expect(after.status).toBe(204);
  });

  test('a Response whose body is already locked destroys the socket, and the server keeps serving', async () => {
    const locked: Http = async (request) => {
      if (new URL(request.url).pathname === '/locked') {
        const response = new Response('{}');
        response.body?.getReader();
        return response;
      }
      return new Response(null, { status: 204 });
    };
    const url = await listening(nodeHttp(locked));

    const answer = await raw(
      url,
      'GET /locked HTTP/1.1\r\nHost: test\r\nConnection: close\r\n\r\n',
    );
    const after = await fetch(`${url}/ok`);

    expect(statusLinesOf(answer)).toEqual([]);
    expect(after.status).toBe(204);
  });

  test('a body that streams is written as it streams, its first chunk reaching the Caller before its last is produced', async () => {
    const { promise: firstReceived, resolve: received } = Promise.withResolvers<void>();
    const encoder = new TextEncoder();
    const streaming: Http = async () => {
      let produced = 0;
      const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
          produced += 1;
          if (produced === 1) {
            controller.enqueue(encoder.encode('first;'));
            return;
          }
          await firstReceived;
          controller.enqueue(encoder.encode('last'));
          controller.close();
        },
      });
      return new Response(body, { status: 200 });
    };
    const url = await listening(nodeHttp(streaming));

    const response = await fetch(`${url}/stream`);
    const reader = (response.body as ReadableStream<Uint8Array>).getReader();
    const first = await reader.read();
    received();
    const last = await reader.read();

    const decoder = new TextDecoder();
    expect([decoder.decode(first.value), decoder.decode(last.value)]).toEqual(['first;', 'last']);
  });

  test('a streamed body larger than the socket buffers reaches a slow-reading Caller whole, its producer waiting for the Caller', async () => {
    const chunk = new Uint8Array(1_048_576).fill(120);
    const chunks = 64;
    let produced = 0;
    const streaming: Http = async () => {
      const body = new ReadableStream<Uint8Array>(
        {
          pull(controller) {
            if (produced === chunks) {
              controller.close();
              return;
            }
            produced += 1;
            controller.enqueue(chunk);
          },
        },
        { highWaterMark: 0 },
      );
      return new Response(body);
    };
    const url = await listening(nodeHttp(streaming));
    const socket = connect(Number(new URL(url).port), '127.0.0.1');
    socket.on('error', () => undefined);
    socket.pause();
    let bytes = 0;
    let tail = '';
    socket.on('data', (data: Buffer) => {
      bytes += data.length;
      tail = data.subarray(-5).toString('latin1');
    });
    const closed = new Promise<void>((resolve) => socket.on('close', () => resolve()));

    socket.write('GET /big HTTP/1.1\r\nHost: test\r\nConnection: close\r\n\r\n');
    await new Promise((resolve) => setTimeout(resolve, 500));
    const producedWhileWaiting = produced;
    socket.resume();
    await closed;

    expect(producedWhileWaiting).toBeLessThan(chunks);
    expect(bytes).toBeGreaterThan(chunks * chunk.length);
    expect(tail).toBe('0\r\n\r\n');
  });

  test('a Caller that leaves while a body streams cancels the body’s stream', async () => {
    const { promise: cancelled, resolve: wasCancelled } = Promise.withResolvers<string>();
    let produced = 0;
    const streaming: Http = async () => {
      const body = new ReadableStream<Uint8Array>(
        {
          pull(controller) {
            produced += 1;
            if (produced === 1) {
              controller.enqueue(new TextEncoder().encode('first;'));
              return;
            }
            return new Promise(() => undefined);
          },
          cancel() {
            wasCancelled('cancelled');
          },
        },
        { highWaterMark: 0 },
      );
      return new Response(body);
    };
    const url = await listening(nodeHttp(streaming));
    const socket = connect(Number(new URL(url).port), '127.0.0.1');
    socket.on('error', () => undefined);
    socket.once('data', () => socket.destroy());

    socket.write('GET /stream HTTP/1.1\r\nHost: test\r\n\r\n');
    const outcome = await Promise.race([
      cancelled,
      new Promise<string>((resolve) => setTimeout(() => resolve('still reading'), 1000)),
    ]);

    expect(outcome).toBe('cancelled');
  });

  test.each([
    { name: 'with data ready', ready: true },
    { name: 'with none yet', ready: false },
  ])(
    'a Caller that leaves before a streaming Response resolves cancels its stream, $name, and leaves nothing waiting',
    async ({ ready }) => {
      const { promise: cancelled, resolve: wasCancelled } = Promise.withResolvers<string>();
      const streaming: Http = async () => {
        await new Promise((resolve) => setTimeout(resolve, 300));
        const body = new ReadableStream<Uint8Array>(
          {
            pull(controller) {
              if (ready) {
                controller.enqueue(new Uint8Array(1024));
                return;
              }
              return new Promise(() => undefined);
            },
            cancel() {
              wasCancelled('cancelled');
            },
          },
          { highWaterMark: 0 },
        );
        return new Response(body);
      };
      const { server, responses } = serverKeeping(streaming);
      const url = await listening(server);
      const socket = connect(Number(new URL(url).port), '127.0.0.1');
      socket.on('error', () => undefined);

      socket.write('GET /events HTTP/1.1\r\nHost: test\r\n\r\n');
      await new Promise((resolve) => setTimeout(resolve, 50));
      socket.destroy();
      const outcome = await Promise.race([
        cancelled,
        new Promise<string>((resolve) => setTimeout(() => resolve('still open'), 1500)),
      ]);
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(outcome).toBe('cancelled');
      expect(responses[0]?.listenerCount('drain')).toBe(0);
    },
  );

  test('a Caller that leaves while the writer waits for drain cancels the body, and leaves nothing waiting', async () => {
    const { promise: cancelled, resolve: wasCancelled } = Promise.withResolvers<string>();
    const chunk = new Uint8Array(1_048_576);
    let produced = 0;
    const streaming: Http = async () => {
      const body = new ReadableStream<Uint8Array>(
        {
          pull(controller) {
            produced += 1;
            controller.enqueue(chunk);
          },
          cancel() {
            wasCancelled('cancelled');
          },
        },
        { highWaterMark: 0 },
      );
      return new Response(body);
    };
    const { server, responses } = serverKeeping(streaming);
    const url = await listening(server);
    const socket = connect(Number(new URL(url).port), '127.0.0.1');
    socket.on('error', () => undefined);
    socket.pause();

    socket.write('GET /big HTTP/1.1\r\nHost: test\r\n\r\n');
    await new Promise((resolve) => setTimeout(resolve, 500));
    const producedWhileWaiting = produced;
    socket.destroy();
    const outcome = await Promise.race([
      cancelled,
      new Promise<string>((resolve) => setTimeout(() => resolve('still open'), 1500)),
    ]);
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(producedWhileWaiting).toBeGreaterThan(0);
    expect(outcome).toBe('cancelled');
    expect(responses[0]?.listenerCount('drain')).toBe(0);
  });

  test('an answer nodeHttp gives itself to a request with no body keeps the connection alive', async () => {
    const url = await listening();
    const traced = 'TRACE /orders HTTP/1.1\r\nHost: test\r\n\r\n';
    const unreadable = 'OPTIONS * HTTP/1.1\r\nHost: test\r\n\r\n';
    const last = 'GET /orders/o-1 HTTP/1.1\r\nHost: test\r\nConnection: close\r\n\r\n';

    const answer = await raw(url, traced + unreadable + last);

    expect(statusLinesOf(answer)).toEqual([
      'HTTP/1.1 404 Not Found',
      'HTTP/1.1 400 Bad Request',
      'HTTP/1.1 200 OK',
    ]);
    expect(answer.split('HTTP/1.1 200')[0]).not.toMatch(/^connection: close$/im);
  });

  test('a GET reaches serve with no body, a DELETE with the body it carries', async () => {
    const seen: (string | null)[] = [];
    const recording: Http = async (request) => {
      seen.push(request.body === null ? null : await request.text());
      return new Response(null, { status: 204 });
    };
    const url = await listening(nodeHttp(recording));

    await fetch(`${url}/orders/o-1`);
    await fetch(`${url}/orders/o-1`, { method: 'DELETE', body: 'gone' });

    expect(seen).toEqual([null, 'gone']);
  });

  test('a request header given several times reaches serve, and repeated response headers are all sent', async () => {
    const seen: (string | null)[] = [];
    const echoing: Http = async (request) => {
      seen.push(request.headers.get('x-key'));
      const headers = new Headers([
        ['set-cookie', 'a=1'],
        ['set-cookie', 'b=2'],
      ]);
      return new Response(null, { status: 204, headers });
    };
    const url = await listening(nodeHttp(echoing));

    const answer = await raw(
      url,
      'GET /x HTTP/1.1\r\nHost: test\r\nX-Key: a\r\nX-Key: b\r\nConnection: close\r\n\r\n',
    );

    expect(seen).toEqual(['a, b']);
    expect(answer.toLowerCase().match(/set-cookie: /g)).toHaveLength(2);
  });

  test('a Success header that cannot travel answers INVALID_OUTCOME and the server keeps serving', async () => {
    const url = await listening(
      nodeHttp(serve(contract, handlers, { onServiceFault: () => undefined })),
    );

    const euro = await fetch(`${url}/greet?name=${encodeURIComponent('€')}`);
    const newline = await fetch(`${url}/greet?name=${encodeURIComponent('a\nb')}`);
    const after = await fetch(`${url}/greet?name=Bob`);

    expect([euro.status, newline.status, after.status]).toEqual([500, 500, 204]);
    expect(await euro.json()).toMatchObject({ fault: { code: 'INVALID_OUTCOME' } });
    expect(after.headers.get('x-greeted')).toBe('Bob');
  });

  test('a response whose body fails while written destroys the socket, and the server keeps serving', async () => {
    const failing: Http = async (request) => {
      if (new URL(request.url).pathname === '/ok') {
        return new Response(null, { status: 204 });
      }
      const body = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"partial":'));
          controller.error(new Error('the body broke'));
        },
      });
      return new Response(body, { status: 200 });
    };
    const url = await listening(nodeHttp(failing));

    const broken = fetch(`${url}/broken`).then((response) => response.text());

    await expect(broken).rejects.toThrow();
    expect((await fetch(`${url}/ok`)).status).toBe(204);
  });

  test('nodeListener answers an Http that rejects with 500 and the Fault Envelope, logs it, and keeps serving', async () => {
    const printed = printedBy('error');
    const broken = new Error('the handler broke');
    const rejecting: Http = async (request) => {
      if (new URL(request.url).pathname === '/ok') {
        return new Response(null, { status: 204 });
      }
      throw broken;
    };
    const url = await listening(nodeHttp(rejecting));

    const rejected = await fetch(`${url}/broken`);
    const after = await fetch(`${url}/ok`);

    expect(rejected.status).toBe(500);
    expect(await rejected.json()).toEqual({
      fault: { committed: 'unknown', retryable: false, message: 'Internal error' },
    });
    expect(printed).toContain(`nodeListener: the handler rejected ${inspect(broken)}`);
    expect(after.status).toBe(204);
  });

  test('with two requests in flight and an onAnswered that throws on the first, both are answered', async () => {
    printedBy('error');
    let records = 0;
    const onAnswered = () => {
      records += 1;
      if (records === 1) {
        throw new Error('the hook broke');
      }
    };
    const url = await listening(nodeHttp(serve(contract, handlers, { onAnswered })));

    const answered = await Promise.all([fetch(`${url}/orders/o-1`), fetch(`${url}/orders/o-2`)]);

    expect(answered.map(({ status }) => status)).toEqual([200, 200]);
  });

  test('an absolute target with credentials is answered 400, and the process lives on', async () => {
    const url = await listening();

    const listened = await listenedTo({ method: 'GET', url: 'http://u:p@test/orders/o-1' });
    const answer = await raw(
      url,
      'GET http://u@test/orders/o-1 HTTP/1.1\r\nHost: test\r\nConnection: close\r\n\r\n',
    );
    const after = await fetch(`${url}/orders/o-1`);

    expect([listened.status, statusLineOf(answer), after.status]).toEqual([
      400,
      'HTTP/1.1 400 Bad Request',
      200,
    ]);
  });

  test('every request header reaches serve, the last one included', async () => {
    const seen: string[][] = [];
    const recording: Http = async (request) => {
      seen.push([...request.headers.keys()]);
      return new Response(null, { status: 204 });
    };
    const url = await listening(nodeHttp(recording));

    await raw(
      url,
      'GET /x HTTP/1.1\r\nHost: test\r\nX-First: 1\r\nX-Last: 2\r\nConnection: close\r\n\r\n',
    );

    expect(seen[0]).toEqual(['connection', 'host', 'x-first', 'x-last']);
  });

  test('a chunked upload over maxBodyBytes is BODY_TOO_LARGE', async () => {
    const url = await listening(nodeHttp(serve(contract, handlers, { maxBodyBytes: 16 })));
    const chunk = '{"quantity":2,"padding":"' + 'x'.repeat(40) + '"}';
    const chunked = `${chunk.length.toString(16)}\r\n${chunk}\r\n0\r\n\r\n`;

    const answer = await raw(
      url,
      `POST /orders HTTP/1.1\r\nHost: test\r\nContent-Type: application/json\r\nX-Api-Key: c-1\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n${chunked}`,
    );

    expect(statusLineOf(answer)).toBe('HTTP/1.1 413 Payload Too Large');
  });

  test('a body serve never reads is discarded by Node, and the connection answers the next request', async () => {
    const url = await listening();
    const body = 'x'.repeat(300_000);
    const first = `POST /nope HTTP/1.1\r\nHost: test\r\nContent-Length: ${body.length}\r\n\r\n${body}`;
    const second = 'GET /orders/o-1 HTTP/1.1\r\nHost: test\r\nConnection: close\r\n\r\n';

    const answer = await rawFor(url, first + second, 1000);

    expect(statusLinesOf(answer.received)).toEqual(['HTTP/1.1 404 Not Found', 'HTTP/1.1 200 OK']);
    expect(answer.received.split('HTTP/1.1 200')[0]).not.toMatch(/^connection: close$/im);
  });

  test('after an unread large body to an undeclared path, the next fetches are answered', async () => {
    const url = await listening();

    const unread = await fetch(`${url}/nope`, { method: 'POST', body: 'x'.repeat(300_000) });
    await unread.arrayBuffer();
    const second = await fetch(`${url}/orders/o-1`);
    await second.arrayBuffer();
    const third = await fetch(`${url}/orders/o-1`);

    expect([unread.status, second.status, third.status]).toEqual([404, 200, 200]);
  });

  test('a body over maxBodyBytes reaches the Caller as 413 and closes its connection, and the next fetches are served', async () => {
    const url = await listening(nodeHttp(serve(contract, handlers, { maxBodyBytes: 1000 })));
    const body = JSON.stringify({ text: 'x'.repeat(300_000) });
    const headers = { 'content-type': 'application/json' };

    const tooLarge = await fetch(`${url}/notes`, { method: 'POST', headers, body });
    await tooLarge.arrayBuffer();
    const second = await fetch(`${url}/orders/o-1`);
    await second.arrayBuffer();
    const third = await fetch(`${url}/orders/o-1`);

    expect([tooLarge.status, second.status, third.status]).toEqual([413, 200, 200]);
    expect(tooLarge.headers.get('connection')).toBe('close');
  });

  test('a small body serve never reads keeps the connection too', async () => {
    const url = await listening();
    const first = 'POST /nope HTTP/1.1\r\nHost: test\r\nContent-Length: 10\r\n\r\n0123456789';
    const second = 'GET /orders/o-1 HTTP/1.1\r\nHost: test\r\nConnection: close\r\n\r\n';

    const answer = await rawFor(url, first + second, 1000);

    expect(statusLinesOf(answer.received)).toEqual(['HTTP/1.1 404 Not Found', 'HTTP/1.1 200 OK']);
    expect(answer.received.split('HTTP/1.1 200')[0]).not.toMatch(/^connection: close$/im);
  });

  test('a request whose body serve read keeps its connection alive', async () => {
    const url = await listening();
    const body = JSON.stringify({ quantity: 2 });
    const first = `POST /orders HTTP/1.1\r\nHost: test\r\nContent-Type: application/json\r\nX-Api-Key: c-1\r\nContent-Length: ${body.length}\r\n\r\n${body}`;
    const second = 'GET /orders/o-1 HTTP/1.1\r\nHost: test\r\nConnection: close\r\n\r\n';

    const answer = await raw(url, first + second);

    expect(statusLinesOf(answer)).toEqual(['HTTP/1.1 201 Created', 'HTTP/1.1 200 OK']);
    expect(answer.split('HTTP/1.1 200')[0]).not.toMatch(/^connection: close$/im);
  });

  test('a bodiless request keeps its connection alive', async () => {
    const url = await listening();
    const first = 'POST /nope HTTP/1.1\r\nHost: test\r\nContent-Length: 0\r\n\r\n';
    const second = 'GET /orders/o-1 HTTP/1.1\r\nHost: test\r\nConnection: close\r\n\r\n';

    const answer = await raw(url, first + second);

    expect(statusLinesOf(answer)).toEqual(['HTTP/1.1 404 Not Found', 'HTTP/1.1 200 OK']);
  });

  test('nodeListener serves a node:http server the Service creates itself', async () => {
    const url = await listening(createServer(nodeListener(serve(contract, handlers, {}))));

    const response = await fetch(`${url}/customers`);

    expect(response.status).toBe(404);
  });

  test('a Handler’s signal is not aborted once its response has finished', async () => {
    const signals: AbortSignal[] = [];
    const watching = handle(getOrder, ({ params }, { request }) => {
      signals.push(request.signal);
      return success(getOrder, { id: params.orderId });
    });
    const served = { ...handlers, endpoints: { ...handlers.endpoints, getOrder: watching } };
    const url = await listening(nodeHttp(serve(contract, served, {})));

    const response = await fetch(`${url}/orders/o-1`);
    await response.text();
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(signals[0]?.aborted).toBe(false);
  });

  test('a Caller that disconnects aborts the signal its EndpointHandler received', async () => {
    const signals: AbortSignal[] = [];
    const { promise: handlerStarted, resolve: started } = Promise.withResolvers<void>();
    const waiting = handle(getOrder, async ({ params }, { request }) => {
      signals.push(request.signal);
      started();
      await new Promise((resolve) => request.signal.addEventListener('abort', resolve));
      return success(getOrder, { id: params.orderId });
    });
    const served = { ...handlers, endpoints: { ...handlers.endpoints, getOrder: waiting } };
    const url = await listening(nodeHttp(serve(contract, served, {})));
    const socket = connect(Number(new URL(url).port), '127.0.0.1');
    socket.on('error', () => undefined);

    socket.write('GET /orders/o-1 HTTP/1.1\r\nHost: test\r\n\r\n');
    await handlerStarted;
    socket.destroy();
    const aborted = new Promise((resolve) => signals[0]?.addEventListener('abort', resolve));
    await Promise.race([aborted, new Promise((resolve) => setTimeout(resolve, 1000))]);

    expect(signals[0]?.aborted).toBe(true);
  });

  test('close() ends the server', async () => {
    const url = await listening();
    const server = servers.pop();

    await new Promise((resolve) => server?.close(resolve));

    await expect(fetch(`${url}/customers`)).rejects.toThrow();
  });
});

describe('nodeHttp after a garbage collection', () => {
  test('a Caller who leaves while the EndpointHandler waits on its signal aborts it, the Handler’s cleanup runs, and onAnswered records it aborted', async () => {
    const events: string[] = [];
    const records: AnsweredRequest[] = [];
    const { promise: handlerStarted, resolve: started } = Promise.withResolvers<void>();
    const { promise: answered, resolve: recorded } = Promise.withResolvers<void>();
    const waiting = handle(getOrder, async ({ params }, { request: { signal } }) => {
      events.push('started');
      started();
      try {
        await new Promise((resolve) => signal.addEventListener('abort', resolve));
        events.push('saw abort');
        return success(getOrder, { id: params.orderId });
      } finally {
        events.push('finally');
      }
    });
    const onAnswered = (record: AnsweredRequest) => {
      records.push(record);
      recorded();
    };
    const served = { ...handlers, endpoints: { ...handlers.endpoints, getOrder: waiting } };
    const url = await listening(nodeHttp(serve(contract, served, { onAnswered })));
    const socket = callerSocket(url);

    socket.write('GET /orders/o-1 HTTP/1.1\r\nHost: test\r\n\r\n');
    await handlerStarted;
    await collected();
    socket.destroy();
    await answered;

    expect(events).toEqual(['started', 'saw abort', 'finally']);
    expect(records.map((record) => record.aborted)).toEqual([true]);
  });

  test('a Caller who leaves while a GuardHandler waits on its signal aborts it', async () => {
    const { promise: guardStarted, resolve: started } = Promise.withResolvers<void>();
    const { promise: sawAbort, resolve: saw } = Promise.withResolvers<string>();
    const waiting = handle(apiKey, async ({ headers }, { request: { signal } }) => {
      started();
      await new Promise((resolve) => signal.addEventListener('abort', resolve));
      saw('saw abort');
      return admit(apiKey, { callerId: headers['x-api-key'] });
    });
    const url = await listening(
      nodeHttp(serve(contract, { ...handlers, guards: { apiKey: waiting } }, {})),
    );
    const socket = callerSocket(url);

    socket.write(
      'POST /orders HTTP/1.1\r\nHost: test\r\nx-api-key: k-1\r\ncontent-type: application/json\r\ncontent-length: 14\r\n\r\n{"quantity":1}',
    );
    await guardStarted;
    await collected();
    socket.destroy();

    expect(await sawAbort).toBe('saw abort');
  });

  test('a Caller who leaves while a large Success is written aborts the signal the Handler kept', async () => {
    const signals: AbortSignal[] = [];
    const large = handle(getOrder, (_input, { request }) => {
      signals.push(request.signal);
      return success(getOrder, { id: 'x'.repeat(16_000_000) });
    });
    const served = { ...handlers, endpoints: { ...handlers.endpoints, getOrder: large } };
    const url = await listening(nodeHttp(serve(contract, served, {})));
    const socket = callerSocket(url);
    const firstData = new Promise((resolve) => socket.once('data', resolve));

    socket.write('GET /orders/o-1 HTTP/1.1\r\nHost: test\r\n\r\n');
    await firstData;
    socket.pause();
    await collected();
    const aborted = new Promise((resolve) => signals[0]?.addEventListener('abort', resolve));
    socket.destroy();
    await aborted;

    expect(signals[0]?.aborted).toBe(true);
  });

  test.each([1, 50])(
    'once %i responses have finished on a kept-open connection, none of their Requests is held',
    async (count) => {
      const requests: WeakRef<Request>[] = [];
      const onAnswered = (_record: AnsweredRequest, request: Request) =>
        void requests.push(new WeakRef(request));
      const url = await listening(nodeHttp(serve(contract, handlers, { onAnswered })));
      const socket = callerSocket(url);
      let received = '';
      socket.on('data', (chunk: Buffer) => {
        received += chunk.toString('latin1');
      });

      socket.write('GET /orders/o-1 HTTP/1.1\r\nHost: test\r\n\r\n'.repeat(count));
      await vi.waitFor(() => expect(statusLinesOf(received)).toHaveLength(count));

      expect(requests).toHaveLength(count);
      await vi.waitFor(async () => {
        await collected();
        expect(heldOf(requests)).toBe(0);
      });
    },
  );
});
