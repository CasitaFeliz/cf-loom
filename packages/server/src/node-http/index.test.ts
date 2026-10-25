import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { type AddressInfo, connect } from 'node:net';
import { PassThrough, Readable } from 'node:stream';
import { defineContract, defineEndpoint, defineGroup, defineGuard } from '@cf-loom/contract';
import { admit, handle, success } from '@cf-loom/handlers';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { z } from 'zod';
import { type Http, serve } from '../index.ts';
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

const contract = defineContract({
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
    createOrder: handle(createOrder, ({ body }, { apiKey: caller }) =>
      success({ headers: { 'x-order-count': 1 }, body: { ...body, by: caller.callerId } }),
    ),
    noteOrder: handle(noteOrder, ({ body }) => success(body)),
    getOrder: handle(getOrder, ({ params }) => success({ id: params.orderId })),
    greet: handle(greet, ({ query }) => success({ headers: { 'x-greeted': query.name } })),
  },
  guards: { apiKey: handle(apiKey, ({ headers }) => admit({ callerId: headers['x-api-key'] })) },
  deprecatedAt: {},
};

const servers: ReturnType<typeof nodeHttp>[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const server of servers.splice(0)) {
    server.close();
  }
});

/** The Service listening on a free port, and the URL it answers at. */
async function listening(server = nodeHttp(serve(contract, handlers))): Promise<string> {
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

/** Sends raw HTTP/1.1 text to the server at `url`, and what came back, once the server closes. */
async function raw(url: string, text: string): Promise<string> {
  const { port } = new URL(url);
  return await new Promise<string>((resolve) => {
    const socket = connect(Number(port), '127.0.0.1');
    let received = '';
    socket.on('data', (chunk) => {
      received += chunk.toString('latin1');
    });
    socket.on('error', () => undefined);
    socket.on('close', () => resolve(received));
    socket.write(text);
  });
}

/**
 * Sends raw HTTP/1.1 text and waits at most `ms` for the server to close the socket: what came
 * back, and whether it closed in time.
 */
async function rawFor(url: string, text: string, ms: number) {
  const { port } = new URL(url);
  return await new Promise<{ readonly received: string; readonly closed: boolean }>((resolve) => {
    const socket = connect(Number(port), '127.0.0.1');
    let received = '';
    const timer = setTimeout(() => {
      socket.destroy();
      resolve({ received, closed: false });
    }, ms);
    socket.on('data', (chunk) => {
      received += chunk.toString('latin1');
    });
    socket.on('error', () => undefined);
    socket.on('close', () => {
      clearTimeout(timer);
      resolve({ received, closed: true });
    });
    socket.write(text);
  });
}

function statusLinesOf(received: string): string[] {
  return received.match(/^HTTP\/1\.1 \d+ .+$/gm) ?? [];
}

function statusLineOf(received: string): string {
  return received.split('\r\n')[0] ?? '';
}

/** The body of a raw response, its chunks joined when it was sent chunked. */
function bodyOf(received: string): string {
  const [head = '', ...rest] = received.split('\r\n\r\n');
  let remaining = rest.join('\r\n\r\n');
  if (!/transfer-encoding: chunked/i.test(head)) {
    return remaining;
  }
  const chunks: string[] = [];
  for (let size = Number.parseInt(remaining, 16); size > 0; ) {
    const start = remaining.indexOf('\r\n') + 2;
    chunks.push(remaining.slice(start, start + size));
    remaining = remaining.slice(start + size + 2);
    size = Number.parseInt(remaining, 16);
  }
  return chunks.join('');
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
    statusCode: 0,
    appendHeader: () => outgoing,
    setHeader: () => outgoing,
    writeHead: () => outgoing,
  });
  const finished = new Promise((resolve) => written.on('finish', resolve));
  nodeListener(serve(contract, handlers))(
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
    const own = createServer({ requireHostHeader: false }, nodeListener(serve(contract, handlers)));
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
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
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
    expect(logged).toHaveBeenCalledWith('nodeListener: the handler rejected', broken);
    expect(after.status).toBe(204);
  });

  test('with two requests in flight and an onOutcome that throws on the first, both are answered', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let records = 0;
    const onOutcome = () => {
      records += 1;
      if (records === 1) {
        throw new Error('the hook broke');
      }
    };
    const url = await listening(nodeHttp(serve(contract, handlers, { onOutcome })));

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

  test('a body serve leaves unread is answered with connection: close, and the socket closes at once', async () => {
    const url = await listening();
    const body = 'x'.repeat(300_000);
    const first = `POST /nope HTTP/1.1\r\nHost: test\r\nContent-Length: ${body.length}\r\n\r\n${body}`;
    const second = 'GET /orders/o-1 HTTP/1.1\r\nHost: test\r\n\r\n';

    const answer = await rawFor(url, first + second, 1000);

    expect(statusLinesOf(answer.received)).toEqual(['HTTP/1.1 404 Not Found']);
    expect(answer.received).toMatch(/^connection: close$/im);
    expect(answer.closed).toBe(true);
  });

  test('after an unread large body to an undeclared path, the next fetches are answered at once', async () => {
    const url = await listening();
    const started = performance.now();

    const unread = await fetch(`${url}/nope`, { method: 'POST', body: 'x'.repeat(300_000) });
    await unread.arrayBuffer();
    const second = await fetch(`${url}/orders/o-1`);
    await second.arrayBuffer();
    const third = await fetch(`${url}/orders/o-1`);

    expect([unread.status, second.status, third.status]).toEqual([404, 200, 200]);
    expect(performance.now() - started).toBeLessThan(1000);
  });

  test('a body over maxBodyBytes reaches the Caller as 413 and closes its connection, and the next fetches are served at once', async () => {
    const url = await listening(nodeHttp(serve(contract, handlers, { maxBodyBytes: 1000 })));
    const body = JSON.stringify({ text: 'x'.repeat(300_000) });
    const headers = { 'content-type': 'application/json' };
    const started = performance.now();

    const tooLarge = await fetch(`${url}/notes`, { method: 'POST', headers, body });
    await tooLarge.arrayBuffer();
    const second = await fetch(`${url}/orders/o-1`);
    await second.arrayBuffer();
    const third = await fetch(`${url}/orders/o-1`);

    expect([tooLarge.status, second.status, third.status]).toEqual([413, 200, 200]);
    expect(tooLarge.headers.get('connection')).toBe('close');
    expect(performance.now() - started).toBeLessThan(1000);
  });

  test('a small body serve leaves unread closes the connection too', async () => {
    const url = await listening();
    const first = 'POST /nope HTTP/1.1\r\nHost: test\r\nContent-Length: 10\r\n\r\n0123456789';
    const second = 'GET /orders/o-1 HTTP/1.1\r\nHost: test\r\n\r\n';

    const answer = await rawFor(url, first + second, 1000);

    expect(statusLinesOf(answer.received)).toEqual(['HTTP/1.1 404 Not Found']);
    expect(answer.received).toMatch(/^connection: close$/im);
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
    const url = await listening(createServer(nodeListener(serve(contract, handlers))));

    const response = await fetch(`${url}/customers`);

    expect(response.status).toBe(404);
  });

  test('close() ends the server', async () => {
    const url = await listening();
    const server = servers.pop();

    await new Promise((resolve) => server?.close(resolve));

    await expect(fetch(`${url}/customers`)).rejects.toThrow();
  });
});
