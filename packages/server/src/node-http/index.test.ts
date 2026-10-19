import { spawnSync } from 'node:child_process';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { type AddressInfo, connect } from 'node:net';
import { PassThrough, Readable } from 'node:stream';
import {
  defineContract,
  defineEndpoint,
  defineGroup,
  defineGuard,
} from '@casitafeliz/loom-contract';
import { admit, handle, success } from '@casitafeliz/loom-handlers';
import { afterEach, describe, expect, test } from 'vitest';
import { z } from 'zod';
import { type Http, serve } from '../index.ts';
import { nodeHttp, nodeListener } from './index.ts';

const apiKey = defineGuard({
  name: 'apiKey',
  description: 'A key per client',
  demands: { headers: z.object({ 'x-api-key': z.string() }) },
  context: z.object({ clientId: z.string() }),
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

const getOrder = defineEndpoint({
  name: 'getOrder',
  method: 'GET',
  path: '/orders/:orderId',
  visibility: 'public',
  description: 'One order',
  input: { params: z.object({ orderId: z.string() }) },
  success: { status: 200, body: z.object({ id: z.string() }) },
});

const headOrder = defineEndpoint({
  name: 'headOrder',
  method: 'HEAD',
  path: '/orders/:orderId',
  visibility: 'public',
  description: 'Whether an order exists',
  input: { params: z.object({ orderId: z.string() }) },
  success: { status: 200, headers: z.object({ 'x-exists': z.boolean() }) },
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
      endpoints: [createOrder, getOrder, headOrder, greet],
    }),
  ],
});

const handlers = {
  endpoints: {
    createOrder: handle(createOrder, ({ body }, { apiKey: client }) =>
      success({ headers: { 'x-order-count': 1 }, body: { ...body, by: client.clientId } }),
    ),
    getOrder: handle(getOrder, ({ params }) => success({ id: params.orderId })),
    headOrder: handle(headOrder, () => success({ headers: { 'x-exists': true } })),
    greet: handle(greet, ({ query }) => success({ headers: { 'x-greeted': query.name } })),
  },
  guards: { apiKey: handle(apiKey, ({ headers }) => admit({ clientId: headers['x-api-key'] })) },
  deprecatedAt: {},
};

const servers: ReturnType<typeof nodeHttp>[] = [];

afterEach(() => {
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
    const url = await listening();

    const answer = await raw(
      url,
      'HEAD /orders/o-1 HTTP/1.1\r\nHost: test\r\nConnection: close\r\n\r\n',
    );

    expect(statusLineOf(answer)).toBe('HTTP/1.1 200 OK');
    expect(answer.toLowerCase()).toContain('x-exists: true');
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

  test('what the handler rejects with, a hook’s throw, reaches the process', () => {
    const entry = new URL('../../dist/node-http/index.js', import.meta.url).href;
    const script = [
      `const { nodeHttp } = await import(${JSON.stringify(entry)});`,
      "const server = nodeHttp(async () => { throw new Error('the hook broke'); }).listen(0);",
      "await new Promise((resolve) => server.once('listening', resolve));",
      "await fetch('http://127.0.0.1:' + server.address().port + '/').catch(() => undefined);",
      'await new Promise((resolve) => setTimeout(resolve, 1000));',
    ].join('\n');

    const ran = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      encoding: 'utf8',
      timeout: 10_000,
    });

    expect(ran.status).not.toBe(0);
    expect(ran.stderr).toContain('the hook broke');
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
