import { once } from 'node:events';
import type { IncomingMessage } from 'node:http';
import {
  connect as connectHttp2,
  constants,
  type Http2SecureServer,
  type Http2Server,
  type IncomingHttpHeaders,
} from 'node:http2';
import { request as httpsRequest } from 'node:https';
import { type AddressInfo, connect } from 'node:net';
import { Writable } from 'node:stream';
import { defineEndpoint, defineGroup, defineGuard, defineService } from '@cf-loom/contract';
import { admit, handle, success } from '@cf-loom/handlers';
import Fastify, {
  type FastifyHttp2Options,
  type FastifyHttp2SecureOptions,
  type FastifyInstance,
  type FastifyPluginAsync,
  type FastifyServerOptions,
} from 'fastify';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { z } from 'zod';
import { allowingHttp1, closeSessions, h2, h2Session, selfSigned } from '../../test/h2.ts';
import { closeFrameProxies, framesProxy, wireEndOf } from '../../test/h2-frames.ts';
import {
  closeRawCallers,
  dataFrame,
  postFrame,
  type RawCaller,
  rawCaller,
  resetFrame,
  windowFrame,
} from '../../test/h2-raw.ts';
import { bodyOf, raw, rawFor, statusLineOf, statusLinesOf } from '../../test/raw-http.ts';
import { type AnsweredRequest, serve } from '../index.ts';
import { nodeHttp } from '../node-http/index.ts';
import { fastifyServe } from './index.ts';

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

const describeOrders = defineEndpoint({
  name: 'describeOrders',
  method: 'OPTIONS',
  path: '/orders',
  visibility: 'public',
  description: 'What an order takes',
  success: { status: 204 },
});

const describeService = defineEndpoint({
  name: 'describeService',
  method: 'OPTIONS',
  path: '/',
  visibility: 'public',
  description: 'What the Service offers',
  success: { status: 204 },
});

const getSummary = defineEndpoint({
  name: 'getSummary',
  method: 'GET',
  path: '/orders/summary',
  visibility: 'public',
  description: 'How many orders there are',
  success: { status: 200, body: z.object({ count: z.int() }) },
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

const noteOrder = defineEndpoint({
  name: 'noteOrder',
  method: 'POST',
  path: '/notes',
  visibility: 'public',
  description: 'A note on an order, with no Guard',
  input: { body: z.object({ text: z.string() }) },
  success: { status: 200, body: z.object({ text: z.string() }) },
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

const getReport = defineEndpoint({
  name: 'getReport',
  method: 'GET',
  path: '/report',
  visibility: 'public',
  description: 'A report too large for one socket buffer',
  success: { status: 200, body: z.object({ data: z.string() }) },
});

const getLegacy = defineEndpoint({
  name: 'getLegacy',
  method: 'GET',
  path: '/legacy',
  visibility: 'public',
  description: 'An Endpoint on its way out',
  lifecycle: 'deprecated',
  deprecatedAt: '2026-10-17T09:30:00Z',
  success: { status: 200, body: z.object({ legacy: z.boolean() }) },
});

const getOldOrders = defineEndpoint({
  name: 'getOldOrders',
  method: 'GET',
  path: '/old-orders',
  visibility: 'public',
  description: 'The old orders',
  lifecycle: 'retired',
  success: { status: 204 },
});

const contract = defineService({
  name: 'orders-service',
  groups: [
    defineGroup({
      name: 'orders',
      description: 'Orders',
      endpoints: [
        createOrder,
        describeOrders,
        describeService,
        getSummary,
        getOrder,
        noteOrder,
        greet,
        getReport,
        getLegacy,
        getOldOrders,
      ],
    }),
  ],
});

const bigData = 'x'.repeat(16_000_000);

const handlers = {
  endpoints: {
    createOrder: handle(createOrder, ({ body }, { context: { apiKey: caller } }) =>
      success(createOrder, {
        headers: { 'x-order-count': 1 },
        body: { ...body, by: caller.callerId },
      }),
    ),
    describeOrders: handle(describeOrders, () => success(describeOrders)),
    describeService: handle(describeService, () => success(describeService)),
    getSummary: handle(getSummary, () => success(getSummary, { count: 3 })),
    getOrder: handle(getOrder, ({ params }) => success(getOrder, { id: params.orderId })),
    noteOrder: handle(noteOrder, ({ body }) => success(noteOrder, body)),
    greet: handle(greet, ({ query }) => success(greet, { headers: { 'x-greeted': query.name } })),
    getReport: handle(getReport, () => success(getReport, { data: bigData })),
    getLegacy: handle(getLegacy, () => success(getLegacy, { legacy: true })),
  },
  guards: {
    apiKey: handle(apiKey, ({ headers }) => admit(apiKey, { callerId: headers['x-api-key'] })),
  },
};

type Handlers = typeof handlers;

/** The Handler map with the Handlers of some Endpoints replaced. */
function withEndpoints(replaced: Partial<Handlers['endpoints']>): Handlers {
  return { ...handlers, endpoints: { ...handlers.endpoints, ...replaced } };
}

type Served = {
  readonly app: FastifyInstance;
  readonly url: string;
  /** Every request that reached the app's own routes or its not-found handler. */
  readonly reached: string[];
};

type Config = {
  readonly handlers?: Handlers;
  readonly options?: {
    readonly maxBodyBytes?: number;
    readonly onAnswered?: (record: AnsweredRequest, request: Request) => void;
  };
  readonly fastify?:
    | FastifyServerOptions
    | FastifyHttp2Options<Http2Server>
    | FastifyHttp2SecureOptions<Http2SecureServer>;
  readonly before?: (app: FastifyInstance, reached: string[]) => void;
  readonly after?: (app: FastifyInstance, reached: string[]) => void;
};

const apps: { close(): PromiseLike<unknown> }[] = [];
const servers: ReturnType<typeof nodeHttp>[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  closeSessions();
  closeFrameProxies();
  closeRawCallers();
  for (const server of servers.splice(0)) {
    server.close();
  }
  await Promise.all(
    apps.splice(0).map((app) => Promise.resolve(app.close()).catch(() => undefined)),
  );
});

/** A Fastify app with its own routes, serving the Contract beside them, listening on a free port. */
async function served(config: Config = {}): Promise<Served> {
  const reached: string[] = [];
  const app = Fastify(config.fastify as FastifyServerOptions);
  apps.push(app);
  app.get('/healthz', async () => {
    reached.push('GET /healthz');
    return 'ok';
  });
  app.setNotFoundHandler(async (request, reply) => {
    reached.push(`${request.method} ${request.url}`);
    return await reply.code(404).send('app: not found');
  });
  config.before?.(app, reached);
  await app.register(fastifyServe(contract, config.handlers ?? handlers, config.options ?? {}));
  config.after?.(app, reached);
  await app.listen({ port: 0, host: '127.0.0.1' });
  const { port } = app.server.address() as AddressInfo;
  const scheme = config.fastify !== undefined && 'https' in config.fastify ? 'https' : 'http';
  return { app, url: `${scheme}://127.0.0.1:${port}`, reached };
}

/** An app route that answers `answer` and records the request it answered. */
function answering(reached: string[], answer: string) {
  return async (request: { readonly method: string; readonly url: string }) => {
    reached.push(`${request.method} ${request.url}`);
    return answer;
  };
}

/** A node:http server serving the same Contract through nodeHttp, to compare with. */
async function nodeServed(): Promise<string> {
  const server = nodeHttp(serve(contract, handlers, {}));
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

/** One raw HTTP/1.1 request that asks the server to close the connection after it. */
function requestText(method: string, target: string, extra = ''): string {
  return `${method} ${target} HTTP/1.1\r\nHost: test\r\n${extra}Connection: close\r\n\r\n`;
}

/** A raw response without the `Date`, which is the one thing two answers to a request differ in. */
function withoutDate(received: string): string {
  return received.replace(/^Date: .*\r\n/im, '');
}

/** The headers of a raw HTTP/1.1 response but its framing and connection ones and `Date`, each name once, its values joined as Node joins them. */
function endToEndHeadersOf(received: string): Record<string, string> {
  const [head = ''] = received.split('\r\n\r\n');
  const hopByHop = ['date', 'connection', 'keep-alive', 'transfer-encoding'];
  const headers: Record<string, string> = {};
  for (const line of head.split('\r\n').slice(1)) {
    const [name = '', ...value] = line.split(': ');
    const key = name.toLowerCase();
    if (!hopByHop.includes(key)) {
      headers[key] =
        headers[key] === undefined ? value.join(': ') : `${headers[key]}, ${value.join(': ')}`;
    }
  }
  return headers;
}

/** The headers of an HTTP/2 response but its pseudo-headers and `Date`. */
function http2HeadersOf(headers: IncomingHttpHeaders): Record<string, string> {
  const named: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (!name.startsWith(':') && name !== 'date' && value !== undefined) {
      named[name] = String(value);
    }
  }
  return named;
}

/** Every warning the process emits while `during` runs. */
async function warningsDuring(during: () => Promise<void>): Promise<string[]> {
  const seen: string[] = [];
  const listener = (warning: Error) => seen.push(`${warning.name}: ${warning.message}`);
  process.on('warning', listener);
  try {
    await during();
    await waitFor(20);
  } finally {
    process.off('warning', listener);
  }
  return seen;
}

function waitFor(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Every uncaught exception the process sees while `during` runs. */
async function uncaughtDuring(during: () => Promise<void>): Promise<Error[]> {
  const seen: Error[] = [];
  const listener = (error: Error) => seen.push(error);
  process.on('uncaughtException', listener);
  try {
    await during();
  } finally {
    process.off('uncaughtException', listener);
  }
  return seen;
}

describe('fastifyServe', () => {
  describe('which requests it takes from Fastify', () => {
    test('a declared Endpoint is answered by cf-loom inside a Fastify app, and the app’s own route answers beside it', async () => {
      const { url, reached } = await served();

      const order = await fetch(`${url}/orders/o-1`);
      const health = await fetch(`${url}/healthz`);

      expect(order.status).toBe(200);
      expect(await order.json()).toEqual({ id: 'o-1' });
      expect(await health.text()).toBe('ok');
      expect(reached).toEqual(['GET /healthz']);
    });

    test('a request to an undeclared path reaches the app’s not-found handler, and onAnswered records nothing for it', async () => {
      const records: unknown[] = [];
      const options = { onAnswered: (record: AnsweredRequest) => void records.push(record) };
      const { url, reached } = await served({ options });

      const response = await fetch(`${url}/customers`);

      expect(response.status).toBe(404);
      expect(await response.text()).toBe('app: not found');
      expect(reached).toEqual(['GET /customers']);
      expect(records).toEqual([]);
    });

    test('a declared Endpoint is cf-loom’s even when an app route, or a catch-all, has the same method and path', async () => {
      const { url, reached } = await served({
        before: (app, marks) => {
          app.post('/orders', answering(marks, 'app route'));
          app.get('/orders/:orderId', answering(marks, 'app param route'));
          app.get('/*', answering(marks, 'app catch-all'));
        },
      });

      const created = await fetch(`${url}/orders`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': 'c-1' },
        body: JSON.stringify({ quantity: 2 }),
      });
      const read = await fetch(`${url}/orders/o-1`);
      const other = await fetch(`${url}/something-else`);

      expect(created.status).toBe(201);
      expect(await read.json()).toEqual({ id: 'o-1' });
      expect(await other.text()).toBe('app catch-all');
      expect(reached).toEqual(['GET /something-else']);
    });

    test('a Retired Endpoint answers RETIRED even when an app route has its path', async () => {
      const { url, reached } = await served({
        before: (app, marks) => void app.get('/old-orders', answering(marks, 'app route')),
      });

      const response = await fetch(`${url}/old-orders`);

      expect(response.status).toBe(410);
      expect(await response.json()).toMatchObject({ fault: { code: 'RETIRED' } });
      expect(reached).toEqual([]);
    });

    test('another method on a declared path reaches the app, never METHOD_NOT_ALLOWED', async () => {
      const { url, reached } = await served({
        before: (app, marks) => void app.put('/notes', answering(marks, 'app put')),
      });

      const deleted = await fetch(`${url}/orders`, { method: 'DELETE' });
      const put = await fetch(`${url}/notes`, { method: 'PUT' });

      expect(deleted.status).toBe(404);
      expect(await deleted.text()).toBe('app: not found');
      expect(await put.text()).toBe('app put');
      expect(reached).toEqual(['DELETE /orders', 'PUT /notes']);
    });

    test('HEAD and an undeclared OPTIONS on a declared path reach the app, and a declared OPTIONS Endpoint is cf-loom’s', async () => {
      const { url, reached } = await served();

      const head = await fetch(`${url}/orders/o-1`, { method: 'HEAD' });
      const undeclared = await fetch(`${url}/notes`, { method: 'OPTIONS' });
      const declared = await fetch(`${url}/orders`, { method: 'OPTIONS' });

      expect([head.status, undeclared.status, declared.status]).toEqual([404, 404, 204]);
      expect(reached).toEqual(['HEAD /orders/o-1', 'OPTIONS /notes']);
    });

    test('a path that starts with // is a path, and an absolute-form target routes on its path and query', async () => {
      const { url, reached } = await served();

      const doubled = await raw(url, requestText('GET', '//orders/o-1'));
      const absolute = await raw(url, requestText('GET', 'http://other/orders/o-1?x=1'));

      expect(statusLineOf(doubled)).toBe('HTTP/1.1 404 Not Found');
      expect(bodyOf(doubled)).toBe('app: not found');
      expect(statusLineOf(absolute)).toBe('HTTP/1.1 200 OK');
      expect(JSON.parse(bodyOf(absolute))).toEqual({ id: 'o-1' });
      expect(reached).toEqual(['GET //orders/o-1']);
    });

    test('an asterisk target, a bad Host and TRACE go on to Fastify, which answers them, with no cf-loom Envelope', async () => {
      const { url } = await served();

      const answers = [
        await raw(url, requestText('OPTIONS', '*')),
        await raw(url, 'GET /orders/o-1 HTTP/1.1\r\nHost: x/orders\r\nConnection: close\r\n\r\n'),
        await raw(url, requestText('TRACE', '/orders')),
      ];

      for (const answer of answers) {
        expect(statusLinesOf(answer)).toHaveLength(1);
        expect(answer).not.toContain('"fault"');
      }
    });

    test('a segment that is not valid percent-encoding is Fastify’s 400', async () => {
      const { url } = await served();

      const answer = await raw(url, requestText('GET', '/orders/%zz'));

      expect(statusLineOf(answer)).toBe('HTTP/1.1 400 Bad Request');
      expect(answer).not.toContain('"fault"');
    });
  });

  describe('the prefilter and serve agree', () => {
    const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'];
    const targets = [
      '/orders',
      '/orders/',
      '/orders/summary',
      '/orders/o-1',
      '/orders/o-1/more',
      '/orders/o%2F1',
      '/orders/%2e%2e',
      '/orders//o-1',
      '//orders',
      '/Orders',
      '/orders\\o-1',
      '/orders?x=1',
      '/notes',
      '/greet?name=Bob',
      '/legacy',
      '/old-orders',
      '/report/x',
      '/',
    ];

    /** Whether serve, through nodeHttp, handed the request back: it answered that no Endpoint has it, or could not read its URL. */
    function handedBack(answer: string): boolean {
      const [status = ''] = statusLinesOf(answer);
      const unreadable = status.startsWith('HTTP/1.1 400') && bodyOf(answer) === '';
      return unreadable || /^HTTP\/1\.1 (404|405)/.test(status);
    }

    test('a request reaches the app exactly when serve answers NO_SUCH_ENDPOINT or METHOD_NOT_ALLOWED, or its URL cannot be read', async () => {
      const { url, reached } = await served();
      const nodeUrl = await nodeServed();
      const disagreements: string[] = [];

      for (const method of methods) {
        for (const target of targets) {
          const text = requestText(method, target, 'Content-Length: 0\r\n');
          reached.length = 0;
          await raw(url, text);
          const answeredByServe = await raw(nodeUrl, text);
          if (reached.length > 0 !== handedBack(answeredByServe)) {
            disagreements.push(`${method} ${target}`);
          }
        }
      }

      expect(disagreements).toEqual([]);
    });

    test('over HTTP/2 too, a request reaches the app exactly when serve answers NO_SUCH_ENDPOINT or METHOD_NOT_ALLOWED, or its URL cannot be read', async () => {
      const { url, reached } = await served({ fastify: { http2: true } });
      const nodeUrl = await nodeServed();
      const session = h2Session(url);
      const disagreements: string[] = [];

      for (const method of methods) {
        for (const target of targets) {
          reached.length = 0;
          await h2(session, { ':method': method, ':path': target });
          const answeredByServe = await raw(
            nodeUrl,
            requestText(method, target, 'Content-Length: 0\r\n'),
          );
          if (reached.length > 0 !== handedBack(answeredByServe)) {
            disagreements.push(`${method} ${target}`);
          }
        }
      }

      expect(disagreements).toEqual([]);
    });
  });

  describe('how it writes the response', () => {
    test('app onSend hooks, registered before or after the plugin, do not run for an Endpoint, and one that throws leaves a Rejection as serve answered it', async () => {
      const sent: string[] = [];
      const throwing = (name: string) => async () => {
        sent.push(name);
        throw new Error(`${name} broke`);
      };
      const { url } = await served({
        before: (app) => app.addHook('onSend', throwing('before')),
        after: (app) => app.addHook('onSend', throwing('after')),
      });
      const nodeUrl = await nodeServed();
      const invalid = requestText(
        'POST',
        '/orders',
        'Content-Type: application/json\r\nX-Api-Key: c-1\r\nContent-Length: 2\r\n',
      );

      const answered = await raw(url, `${invalid}{}`);
      const expected = await raw(nodeUrl, `${invalid}{}`);
      const sentForEndpoint = [...sent];
      await fetch(`${url}/healthz`);

      expect(statusLineOf(answered)).toBe('HTTP/1.1 400 Bad Request');
      expect(withoutDate(answered)).toBe(withoutDate(expected));
      expect(sentForEndpoint).toEqual([]);
      expect(sent).toContain('before');
    });

    test.each([
      {
        name: 'a Success with a header',
        method: 'POST',
        target: '/orders',
        body: '{"quantity":2}',
      },
      { name: 'an invalid-input Rejection', method: 'POST', target: '/orders', body: '{}' },
      { name: 'a Deprecated Endpoint’s Success', method: 'GET', target: '/legacy', body: '' },
      { name: 'a Retired Endpoint’s RETIRED', method: 'GET', target: '/old-orders', body: '' },
      { name: 'a Success with no body', method: 'GET', target: '/greet?name=Bob', body: '' },
    ])(
      '$name reaches the Caller as nodeHttp sends it, every header once and its bytes',
      async (sent) => {
        const { url } = await served();
        const nodeUrl = await nodeServed();
        const headers = `X-Api-Key: c-1\r\nContent-Type: application/json\r\nContent-Length: ${sent.body.length}\r\n`;
        const text = requestText(sent.method, sent.target, headers) + sent.body;

        const answered = await raw(url, text);
        const expected = await raw(nodeUrl, text);

        expect(withoutDate(answered)).toBe(withoutDate(expected));
        expect(answered.match(/^deprecation:/gim)?.length ?? 0).toBeLessThanOrEqual(1);
      },
    );

    test('a Success with no body is sent with an empty body', async () => {
      const { url } = await served();

      const response = await fetch(`${url}/greet?name=Bob`);

      expect(response.status).toBe(204);
      expect(response.headers.get('x-greeted')).toBe('Bob');
      expect(await response.text()).toBe('');
    });

    test('a header an app onRequest hook registered before the plugin set reaches the Caller with an Endpoint’s answer, where serve’s own header wins', async () => {
      const hooked: string[] = [];
      const { url } = await served({
        before: (app) =>
          app.addHook('onRequest', async (_request, reply) => {
            reply.header('access-control-allow-origin', '*');
            reply.header('content-type', 'text/plain');
          }),
        after: (app) => app.addHook('onRequest', async (request) => void hooked.push(request.url)),
      });

      const endpoint = await fetch(`${url}/orders/o-1`);
      const own = await fetch(`${url}/healthz`);

      expect(endpoint.headers.get('access-control-allow-origin')).toBe('*');
      expect(endpoint.headers.get('content-type')).toBe('application/json; charset=utf-8');
      expect(own.headers.get('access-control-allow-origin')).toBe('*');
      expect(hooked).toEqual(['/healthz']);
    });

    test('the app’s onResponse hook and Fastify’s request log see an Endpoint’s request, with the status serve answered', async () => {
      const lines: { msg: string; res?: { statusCode: number } }[] = [];
      const stream = new Writable({
        write(chunk, _encoding, done) {
          lines.push(JSON.parse(String(chunk)));
          done();
        },
      });
      const statuses: number[] = [];
      const { url } = await served({
        fastify: { logger: { stream, level: 'info' } },
        after: (app) =>
          app.addHook(
            'onResponse',
            async (_request, reply) => void statuses.push(reply.statusCode),
          ),
      });

      const response = await fetch(`${url}/orders/o-1`);
      await response.text();
      await waitFor(50);

      expect(statuses).toEqual([200]);
      expect(lines.find((line) => line.msg === 'request completed')?.res?.statusCode).toBe(200);
    });
  });

  describe('bodies and connections', () => {
    test('a body larger than the app’s bodyLimit reaches the Handler whole', async () => {
      const { url } = await served({ fastify: { bodyLimit: 1024 } });
      const text = 'x'.repeat(100_000);

      const response = await fetch(`${url}/notes`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text }),
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ text });
    });

    test('a body over maxBodyBytes is BODY_TOO_LARGE with connection: close, and the connection closes', async () => {
      const { url } = await served({ options: { maxBodyBytes: 1000 } });
      const body = JSON.stringify({ text: 'x'.repeat(300_000) });
      const first = requestText(
        'POST',
        '/notes',
        `Content-Type: application/json\r\nContent-Length: ${body.length}\r\n`,
      ).replace('Connection: close\r\n', '');
      const second = 'GET /orders/o-1 HTTP/1.1\r\nHost: test\r\n\r\n';

      const answer = await rawFor(url, first + body + second, 1000);

      expect(statusLinesOf(answer.received)).toEqual(['HTTP/1.1 413 Payload Too Large']);
      expect(answer.received).toMatch(/^connection: close$/im);
      expect(answer.received).toContain('"BODY_TOO_LARGE"');
      expect(answer.closed).toBe(true);
    });

    test('a request whose body serve read keeps its connection alive', async () => {
      const { url } = await served();
      const body = JSON.stringify({ quantity: 2 });
      const first = `POST /orders HTTP/1.1\r\nHost: test\r\nContent-Type: application/json\r\nX-Api-Key: c-1\r\nContent-Length: ${body.length}\r\n\r\n${body}`;
      const second = requestText('GET', '/orders/o-1');

      const answer = await raw(url, first + second);

      expect(statusLinesOf(answer)).toEqual(['HTTP/1.1 201 Created', 'HTTP/1.1 200 OK']);
      expect(answer.split('HTTP/1.1 200')[0]).not.toMatch(/^connection: close$/im);
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
      const { url } = await served({ handlers: withEndpoints({ getOrder: waiting }) });
      const socket = connect(Number(new URL(url).port), '127.0.0.1');
      socket.on('error', () => undefined);

      socket.write('GET /orders/o-1 HTTP/1.1\r\nHost: test\r\n\r\n');
      await handlerStarted;
      socket.destroy();
      const aborted = new Promise((resolve) => signals[0]?.addEventListener('abort', resolve));
      await Promise.race([aborted, waitFor(1000)]);

      expect(signals[0]?.aborted).toBe(true);
    });

    test('a Caller that leaves while its Handler runs makes the request reach onRequestAbort and never onResponse, over HTTP/1.1', async () => {
      const hooks: string[] = [];
      const { promise: handlerStarted, resolve: started } = Promise.withResolvers<void>();
      const waiting = handle(getOrder, async ({ params }, { request }) => {
        started();
        await new Promise((resolve) => request.signal.addEventListener('abort', resolve));
        return success(getOrder, { id: params.orderId });
      });
      const { url } = await served({
        handlers: withEndpoints({ getOrder: waiting }),
        before: (app) =>
          app.addHook('onRequestAbort', async (request) => void hooks.push(`abort ${request.url}`)),
        after: (app) =>
          app.addHook('onResponse', async (request) => void hooks.push(`response ${request.url}`)),
      });
      const socket = connect(Number(new URL(url).port), '127.0.0.1');
      socket.on('error', () => undefined);

      socket.write('GET /orders/o-1 HTTP/1.1\r\nHost: test\r\n\r\n');
      await handlerStarted;
      socket.destroy();
      await waitFor(200);

      expect(hooks).toEqual(['abort /orders/o-1']);
    });

    test('a Handler’s signal is not aborted once its response has finished', async () => {
      const signals: AbortSignal[] = [];
      const watching = handle(getOrder, ({ params }, { request }) => {
        signals.push(request.signal);
        return success(getOrder, { id: params.orderId });
      });
      const { url } = await served({ handlers: withEndpoints({ getOrder: watching }) });

      const response = await fetch(`${url}/orders/o-1`);
      await response.text();
      await waitFor(50);

      expect(signals[0]?.aborted).toBe(false);
    });
  });

  describe('a body the Caller stops sending', () => {
    test('over HTTP/1.1, a Caller that leaves while its body is read fails the read, and onAnswered records the request aborted', async () => {
      const records: AnsweredRequest[] = [];
      const { promise: recorded, resolve: record } = Promise.withResolvers<void>();
      const { url } = await served({
        options: {
          onAnswered: (answered) => {
            records.push(answered);
            record();
          },
        },
      });
      const socket = connect(Number(new URL(url).port), '127.0.0.1');
      socket.on('error', () => undefined);

      socket.write(
        'POST /notes HTTP/1.1\r\nHost: test\r\nContent-Type: application/json\r\nContent-Length: 100\r\n\r\n{"text":',
      );
      await waitFor(50);
      socket.destroy();
      await Promise.race([recorded, waitFor(1000)]);

      expect(records.map(({ status, code, aborted }) => ({ status, code, aborted }))).toEqual([
        { status: 400, code: 'INVALID_INPUT', aborted: true },
      ]);
    });

    test('over HTTP/2, a Caller that ends its body, then resets, has its body read as it ended it', async () => {
      const records: AnsweredRequest[] = [];
      const { promise: recorded, resolve: record } = Promise.withResolvers<void>();
      const { url } = await served({
        fastify: { http2: true },
        options: {
          onAnswered: (answered) => {
            records.push(answered);
            record();
          },
        },
      });
      const session = h2Session(url);

      const stream = session.request({
        ':method': 'POST',
        ':path': '/notes',
        'content-type': 'application/json',
      });
      stream.on('error', () => undefined);
      stream.write('{"text":');
      await waitFor(50);
      stream.close(constants.NGHTTP2_CANCEL);
      await recorded;

      expect(records.map(({ status, code }) => ({ status, code }))).toEqual([
        { status: 400, code: 'INVALID_INPUT' },
      ]);
    });

    test.each([
      {
        name: 'resets its stream with CANCEL',
        leave: (caller: RawCaller) => caller.send(resetFrame(1, 8)),
      },
      {
        name: 'resets its stream with NO_ERROR',
        leave: (caller: RawCaller) => caller.send(resetFrame(1, 0)),
      },
      { name: 'loses its connection', leave: (caller: RawCaller) => caller.drop() },
    ])(
      'over HTTP/2, a Caller that $name before its END_STREAM, after a whole JSON value, fails the read, and no Handler runs',
      async ({ leave }) => {
        const records: AnsweredRequest[] = [];
        const handled: string[] = [];
        const { promise: recorded, resolve: record } = Promise.withResolvers<void>();
        const noting = handle(noteOrder, ({ body }) => {
          handled.push(body.text);
          return success(noteOrder, body);
        });
        const { url } = await served({
          fastify: { http2: true },
          handlers: withEndpoints({ noteOrder: noting }),
          options: {
            onAnswered: (answered) => {
              records.push(answered);
              record();
            },
          },
        });
        const caller = rawCaller(url);

        caller.send(
          postFrame(1, '/notes', { 'content-length': '100' }),
          dataFrame(1, '{"text":"half of what I meant"}'),
        );
        await waitFor(100);
        leave(caller);
        await recorded;

        expect(records.map(({ status, code }) => ({ status, code }))).toEqual([
          { status: 400, code: 'INVALID_INPUT' },
        ]);
        expect(handled).toEqual([]);
      },
    );
  });

  describe('a claimed request is never Fastify’s again', () => {
    /** Reads a first piece of a response to `path`, then goes away without reading the rest. */
    async function leavingMidResponse(url: string, path: string): Promise<void> {
      const socket = connect(Number(new URL(url).port), '127.0.0.1');
      socket.on('error', () => undefined);
      const { promise: firstPiece, resolve: gotPiece } = Promise.withResolvers<void>();
      socket.once('data', () => {
        socket.pause();
        gotPiece();
      });
      socket.write(requestText('GET', path));
      await firstPiece;
      socket.destroy();
    }

    test('a Caller that goes away while a large Success is written closes the connection, and neither an app route nor the not-found handler runs', async () => {
      const { app, url, reached } = await served({
        before: (appInstance, marks) => {
          appInstance.get('/report', answering(marks, 'app route'));
        },
      });

      const uncaught = await uncaughtDuring(async () => {
        await leavingMidResponse(url, '/report');
        await waitFor(300);
      });

      const connections = await new Promise<number>((resolve) => {
        app.server.getConnections((_, count) => resolve(count));
      });
      expect(connections).toBe(0);
      expect(reached).toEqual([]);
      expect(uncaught).toEqual([]);
    });

    test('with handlerTimeout shorter than the Handler, the Caller receives the Endpoint’s answer, never Fastify’s 503: once taken, the request is no longer Fastify’s', async () => {
      const slow = handle(getOrder, async ({ params }) => {
        await waitFor(250);
        return success(getOrder, { id: params.orderId });
      });
      const { url } = await served({
        fastify: { handlerTimeout: 50 },
        handlers: withEndpoints({ getOrder: slow }),
      });

      const uncaught = await uncaughtDuring(async () => {
        const response = await fetch(`${url}/orders/o-1`);
        expect([response.status, await response.json()]).toEqual([200, { id: 'o-1' }]);
        await waitFor(100);
      });

      expect(uncaught).toEqual([]);
    });

    test('handlerTimeout firing while a large Success is written to a slow-reading Caller neither ends the process nor cuts the response', async () => {
      const { url } = await served({ fastify: { handlerTimeout: 100 } });
      const socket = connect(Number(new URL(url).port), '127.0.0.1');
      socket.on('error', () => undefined);
      const chunks: Buffer[] = [];
      socket.on('data', (chunk) => chunks.push(chunk));
      const closed = new Promise<void>((resolve) => socket.on('close', () => resolve()));

      const uncaught = await uncaughtDuring(async () => {
        socket.pause();
        socket.write(requestText('GET', '/report'));
        await waitFor(400);
        socket.resume();
        await closed;
      });

      const received = Buffer.concat(chunks).toString('latin1');
      expect(uncaught).toEqual([]);
      expect(statusLineOf(received)).toBe('HTTP/1.1 200 OK');
      expect(bodyOf(received).length).toBe(JSON.stringify({ data: bigData }).length);
    });
  });

  describe('when something fails once a request is taken', () => {
    test('a header an earlier app hook set that Node refuses destroys the socket for an Endpoint, and the app’s routes keep answering', async () => {
      const { url } = await served({
        before: (app) =>
          app.addHook('onRequest', async (request, reply) => {
            if (request.url.startsWith('/orders')) {
              reply.header('x-bad', 'a\u0001b');
            }
          }),
      });

      const uncaught = await uncaughtDuring(async () => {
        const endpoint = await rawFor(url, requestText('GET', '/orders/o-1'), 1000);
        expect(endpoint).toEqual({ received: '', closed: true });
      });
      const own = await fetch(`${url}/healthz`);

      expect(uncaught).toEqual([]);
      expect(await own.text()).toBe('ok');
    });

    test('a content-length an earlier app hook set never reaches the Caller, since the body is framed by Node', async () => {
      const { url } = await served({
        before: (app) =>
          app.addHook('onRequest', async (_request, reply) => {
            reply.header('content-length', '5');
          }),
      });

      const answer = await raw(url, requestText('GET', '/orders/o-1'));

      const [head = ''] = answer.split('\r\n\r\n');
      expect(head).not.toMatch(/^content-length:/im);
      expect(head).toMatch(/^transfer-encoding: chunked$/im);
      expect(bodyOf(answer)).toBe('{"id":"o-1"}');
    });
  });

  describe('when the Caller leaves or something fails before the response is written', () => {
    test('a Caller that leaves during an earlier async app onRequest hook aborts the Handler’s signal, and onAnswered records it', async () => {
      const startedAborted: boolean[] = [];
      const records: AnsweredRequest[] = [];
      const reading = handle(getOrder, ({ params }, { request }) => {
        startedAborted.push(request.signal.aborted);
        return success(getOrder, { id: params.orderId });
      });
      const { promise: hookRunning, resolve: running } = Promise.withResolvers<void>();
      const { url } = await served({
        handlers: withEndpoints({ getOrder: reading }),
        options: { onAnswered: (record) => void records.push(record) },
        before: (app) =>
          app.addHook('onRequest', async () => {
            running();
            await waitFor(300);
          }),
      });
      const socket = connect(Number(new URL(url).port), '127.0.0.1');
      socket.on('error', () => undefined);

      socket.write(requestText('GET', '/orders/o-1'));
      await hookRunning;
      socket.destroy();
      await waitFor(600);

      expect(startedAborted).toEqual([true]);
      expect(records.map((record) => record.aborted)).toEqual([true]);
    });

    test('a content-length an earlier app hook set on the raw response never reaches the Caller either', async () => {
      const { url } = await served({
        before: (app) =>
          app.addHook('onRequest', async (_request, reply) => {
            reply.raw.setHeader('content-length', '5');
          }),
      });

      const answer = await raw(url, requestText('GET', '/orders/o-1'));

      const [head = ''] = answer.split('\r\n\r\n');
      expect(head).not.toMatch(/^content-length:/im);
      expect(bodyOf(answer)).toBe('{"id":"o-1"}');
    });

    test('a write that fails after serve answered still records the status serve answered, and reaches onRequestAbort, never onResponse', async () => {
      const records: AnsweredRequest[] = [];
      const hooks: string[] = [];
      const { url } = await served({
        options: { onAnswered: (record) => void records.push(record) },
        before: (app) => {
          app.addHook('onRequest', async (request, reply) => {
            if (request.url.startsWith('/orders')) {
              reply.header('x-bad', 'a\u0001b');
            }
          });
          app.addHook('onRequestAbort', async (_request) => void hooks.push('onRequestAbort'));
        },
        after: (app) => app.addHook('onResponse', async () => void hooks.push('onResponse')),
      });

      await rawFor(url, requestText('GET', '/orders/o-1'), 1000);
      await waitFor(100);

      expect(records.map((record) => record.status)).toEqual([200]);
      expect(hooks).toEqual(['onRequestAbort']);
    });
  });

  describe('registration', () => {
    test('inside a plugin that skips encapsulation, it serves the Contract', async () => {
      const app = Fastify();
      apps.push(app);
      const wrapper: FastifyPluginAsync = async (instance) => {
        await instance.register(fastifyServe(contract, handlers, {}));
      };
      Object.assign(wrapper, { [Symbol.for('skip-override')]: true });
      await app.register(wrapper);

      const response = await app.inject({ method: 'GET', url: '/orders/o-1' });

      expect([response.statusCode, response.json()]).toEqual([200, { id: 'o-1' }]);
    });

    test('registering it with a prefix throws, naming fastifyServe', async () => {
      const app = Fastify();
      apps.push(app);

      const registering = app.register(fastifyServe(contract, handlers, {}), { prefix: '/api' });

      await expect(registering).rejects.toThrow(/fastifyServe.*prefix/);
    });

    test('registering it inside an encapsulated plugin throws, naming fastifyServe', async () => {
      const app = Fastify();
      apps.push(app);

      const encapsulated: FastifyPluginAsync = async (child) => {
        await child.register(fastifyServe(contract, handlers, {}));
      };

      const registering = app.register(encapsulated);

      await expect(registering).rejects.toThrow(/fastifyServe.*encapsulated/);
    });

    test('a Handler map missing a Handler throws when fastifyServe is called, before register', () => {
      const { getSummary: _, ...missing } = handlers.endpoints;

      // @ts-expect-error TS2741 getSummary has no Handler
      const calling = () => fastifyServe(contract, { ...handlers, endpoints: missing }, {});

      expect(calling).toThrow(/getSummary/);
    });
  });

  describe('over HTTP/2', () => {
    test('on an h2c app, a declared Endpoint is answered by cf-loom, the app’s own route answers beside it, and the app’s onResponse hook sees the Endpoint’s request', async () => {
      const responded: string[] = [];
      const { url, reached } = await served({
        fastify: { http2: true },
        after: (app) =>
          app.addHook('onResponse', async (request) => void responded.push(request.url)),
      });
      const session = h2Session(url);

      const order = await h2(session, { ':path': '/orders/o-1' });
      const health = await h2(session, { ':path': '/healthz' });
      await waitFor(50);

      expect([order.status, JSON.parse(order.body)]).toEqual([200, { id: 'o-1' }]);
      expect([health.status, health.body]).toEqual([200, 'ok']);
      expect(reached).toEqual(['GET /healthz']);
      expect(responded).toEqual(['/orders/o-1', '/healthz']);
    });

    test('serve receives the Request on the URL :scheme, :authority and the path make, with the Caller’s headers and no pseudo-header', async () => {
      const seen: Request[] = [];
      const reading = handle(getOrder, (_input, { request }) =>
        success(getOrder, { id: request.headers.get('x-tenant') ?? 'none' }),
      );
      const { url } = await served({
        fastify: { http2: true },
        handlers: withEndpoints({ getOrder: reading }),
        options: { onAnswered: (_record, request) => void seen.push(request) },
      });
      const session = h2Session(url);

      const answer = await h2(session, {
        ':path': '/orders/o-1?x=1',
        ':scheme': 'https',
        ':authority': 'orders.example:8443',
        'x-tenant': 't-1',
      });

      expect(JSON.parse(answer.body)).toEqual({ id: 't-1' });
      expect(seen[0]?.url).toBe('https://orders.example:8443/orders/o-1?x=1');
      expect([...(seen[0]?.headers.keys() ?? [])].filter((name) => name.startsWith(':'))).toEqual(
        [],
      );
    });

    test.each([
      {
        name: 'a Success with a header',
        method: 'POST',
        target: '/orders',
        body: '{"quantity":2}',
      },
      { name: 'an invalid-input Rejection', method: 'POST', target: '/orders', body: '{}' },
      { name: 'a Deprecated Endpoint’s Success', method: 'GET', target: '/legacy', body: '' },
      { name: 'a Retired Endpoint’s RETIRED', method: 'GET', target: '/old-orders', body: '' },
      { name: 'a Success with no body', method: 'GET', target: '/greet?name=Bob', body: '' },
    ])(
      '$name has over HTTP/2 the status, headers and bytes it has over HTTP/1.1, with no connection header and no warning',
      async (sent) => {
        const { url } = await served({ fastify: { http2: true } });
        const nodeUrl = await nodeServed();
        const session = h2Session(url);
        const headers = `X-Api-Key: c-1\r\nContent-Type: application/json\r\nContent-Length: ${sent.body.length}\r\n`;
        const expected = await raw(
          nodeUrl,
          requestText(sent.method, sent.target, headers) + sent.body,
        );
        let answer: Awaited<ReturnType<typeof h2>> | undefined;

        const warnings = await warningsDuring(async () => {
          answer = await h2(
            session,
            {
              ':method': sent.method,
              ':path': sent.target,
              'x-api-key': 'c-1',
              'content-type': 'application/json',
            },
            sent.method === 'GET' ? undefined : sent.body,
          );
        });

        expect(answer?.status).toBe(Number(statusLineOf(expected).split(' ')[1]));
        expect(http2HeadersOf(answer?.headers ?? {})).toEqual(endToEndHeadersOf(expected));
        expect(answer?.headers.connection).toBeUndefined();
        expect(answer?.body).toBe(bodyOf(expected));
        expect(warnings).toEqual([]);
      },
    );

    test('a request with no :authority is on the origin its Host names', async () => {
      const seen: string[] = [];
      const { url } = await served({
        fastify: { http2: true },
        options: { onAnswered: (_record, request) => void seen.push(request.url) },
      });
      const session = h2Session(url);

      const answer = await h2(session, { ':path': '/orders/o-1', host: 'orders.example' });

      expect(answer.status).toBe(200);
      expect(seen).toEqual(['http://orders.example/orders/o-1']);
    });

    test('several Cookie fields reach the Handler as one header, joined by "; "', async () => {
      const reading = handle(getOrder, (_input, { request }) =>
        success(getOrder, { id: request.headers.get('cookie') ?? 'none' }),
      );
      const { url } = await served({
        fastify: { http2: true },
        handlers: withEndpoints({ getOrder: reading }),
      });
      const session = h2Session(url);

      const answer = await h2(session, { ':path': '/orders/o-1', cookie: ['a=1', 'b=2'] });

      expect(JSON.parse(answer.body)).toEqual({ id: 'a=1; b=2' });
    });

    test('a :scheme other than http or https, and OPTIONS *, go on to the app, even beside a declared OPTIONS /', async () => {
      const { url, reached } = await served({ fastify: { http2: true } });
      const session = h2Session(url);

      const foreign = await h2(session, { ':path': '/orders/o-1', ':scheme': 'ftp' });
      const asterisk = await h2(session, {
        ':method': 'OPTIONS',
        ':path': '*',
        ':authority': 'orders.example',
      });

      expect([foreign.status, asterisk.status]).toEqual([404, 404]);
      expect(reached).toEqual(['GET /orders/o-1', 'OPTIONS *']);
    });

    describe('a body serve answers before reading whole', () => {
      const upload = JSON.stringify({ text: 'x'.repeat(1_000_000) });

      test('a BODY_TOO_LARGE held back until the Caller opens its window still ends with END_STREAM, then a reset, and the server closes', async () => {
        const { app, url } = await served({
          fastify: { http2: true },
          options: { maxBodyBytes: 1000 },
        });
        const caller = rawCaller(url, { window: 0 });

        caller.send(
          postFrame(1, '/notes'),
          dataFrame(1, JSON.stringify({ text: 'x'.repeat(3000) })),
        );
        await waitFor(300);
        const held = [...caller.framesOf(1)];
        caller.send(windowFrame(1, 1 << 20), windowFrame(0, 1 << 20));
        while (!caller.framesOf(1).some((frame) => frame.startsWith('RST'))) {
          await waitFor(5);
        }
        caller.drop();
        await app.close();

        expect(held).toEqual(['HEADERS']);
        expect(wireEndOf(caller.framesOf(1))).toBe('end, then RST(0)');
      });

      test.each([
        {
          name: 'a body over maxBodyBytes is BODY_TOO_LARGE',
          path: '/notes',
          headers: {},
          status: 413,
          code: 'BODY_TOO_LARGE',
        },
        {
          name: 'a Guard’s Rejection, answered before the body is read,',
          path: '/orders',
          headers: {},
          status: 400,
          code: 'INVALID_INPUT',
        },
      ])(
        '$name: the Caller receives it whole with END_STREAM, then its stream is reset with NO_ERROR and its upload stops, the session goes on, and the server closes once the session is gone',
        async (asked) => {
          const { app, url } = await served({
            fastify: { http2: true },
            options: { maxBodyBytes: 1000 },
          });
          const wire = await framesProxy(url);
          const session = h2Session(wire.url);
          const headers = { ':method': 'POST', ':path': asked.path, ...asked.headers };

          const answer = await Promise.race([
            h2(session, { ...headers, 'content-type': 'application/json' }, upload),
            waitFor(2000).then(() => 'still open'),
          ]);
          const next = await Promise.race([
            h2(session, { ':path': '/orders/o-1' }),
            waitFor(1000).then(() => 'unanswered'),
          ]);
          session.destroy();
          const closing = await Promise.race([
            app.close().then(() => 'closed'),
            waitFor(2000).then(() => 'still open'),
          ]);

          expect(answer).toMatchObject({ status: asked.status, ended: true, rstCode: 0 });
          expect(wireEndOf(wire.framesOf(1))).toBe('end, then RST(0)');
          expect(wireEndOf(wire.framesOf(3))).toBe('end');
          expect(typeof answer === 'string' ? '' : answer.body).toContain(`"${asked.code}"`);
          expect(typeof answer === 'string' ? 0 : answer.sent).toBeLessThan(upload.length);
          expect(next).toMatchObject({ status: 200, body: '{"id":"o-1"}' });
          expect(closing).toBe('closed');
        },
      );
    });

    test('an Endpoint’s response ends with END_STREAM and no reset, with a body or without one', async () => {
      const { url } = await served({ fastify: { http2: true } });
      const wire = await framesProxy(url);
      const session = h2Session(wire.url);

      const order = await h2(session, { ':path': '/orders/o-1' });
      const greeted = await h2(session, { ':path': '/greet?name=Bob' });
      await waitFor(50);

      expect([order.status, greeted.status]).toEqual([200, 204]);
      expect(wire.framesOf(1)).toEqual(['HEADERS', 'DATA', 'DATA+END']);
      expect(wireEndOf(wire.framesOf(3))).toBe('end');
    });

    describe('the Caller’s departure', () => {
      test('a Caller that resets its stream aborts the signal its EndpointHandler received, onAnswered records it, and the session goes on', async () => {
        const signals: AbortSignal[] = [];
        const records: AnsweredRequest[] = [];
        const { promise: handlerStarted, resolve: started } = Promise.withResolvers<void>();
        const waiting = handle(getOrder, async ({ params }, { request }) => {
          signals.push(request.signal);
          started();
          await new Promise((resolve) => request.signal.addEventListener('abort', resolve));
          return success(getOrder, { id: params.orderId });
        });
        const { url } = await served({
          fastify: { http2: true },
          handlers: withEndpoints({ getOrder: waiting }),
          options: { onAnswered: (record) => void records.push(record) },
        });
        const session = h2Session(url);

        const stream = session.request({ ':path': '/orders/o-1' });
        stream.on('error', () => undefined);
        await handlerStarted;
        stream.close(constants.NGHTTP2_CANCEL);
        await Promise.race([
          new Promise((resolve) => signals[0]?.addEventListener('abort', resolve)),
          waitFor(1000),
        ]);
        await waitFor(50);
        const recorded = records.map((record) => record.aborted);
        const next = await h2(session, { ':path': '/orders/summary' });

        expect(signals[0]?.aborted).toBe(true);
        expect(recorded).toEqual([true]);
        expect(next).toMatchObject({ status: 200, body: '{"count":3}' });
      });

      test('a Caller that resets its stream once the whole response is written, but before flow control let it out, aborts the request’s signal', async () => {
        const requests: Request[] = [];
        const small = handle(getReport, () => success(getReport, { data: 'x'.repeat(5000) }));
        const { url } = await served({
          fastify: { http2: true },
          handlers: withEndpoints({ getReport: small }),
          options: { onAnswered: (_record, request) => void requests.push(request) },
        });
        const session = connectHttp2(url, { settings: { initialWindowSize: 1024 } });
        session.on('error', () => undefined);

        try {
          const stream = session.request({ ':path': '/report' });
          stream.on('error', () => undefined);
          await new Promise((resolve) => stream.once('data', resolve));
          stream.pause();
          stream.close(constants.NGHTTP2_CANCEL);
          await waitFor(100);
        } finally {
          session.destroy();
        }

        expect(requests[0]?.signal.aborted).toBe(true);
      });

      test('a Caller that resets its stream with NO_ERROR while a large Success is written aborts the request’s signal, and the server closes once the session is gone', async () => {
        const requests: Request[] = [];
        const { app, url } = await served({
          fastify: { http2: true },
          options: { onAnswered: (_record, request) => void requests.push(request) },
        });
        const session = h2Session(url);

        const stream = session.request({ ':path': '/report' });
        stream.on('error', () => undefined);
        await new Promise((resolve) => stream.once('data', resolve));
        stream.pause();
        await waitFor(50);
        stream.close(constants.NGHTTP2_NO_ERROR);
        await waitFor(100);
        const aborted = requests[0]?.signal.aborted;
        session.destroy();
        const closing = await Promise.race([
          app.close().then(() => 'closed'),
          waitFor(2000).then(() => 'still open'),
        ]);

        expect(aborted).toBe(true);
        expect(closing).toBe('closed');
      });

      test('a Caller that leaves while its Handler runs makes the request reach onRequestAbort and then onResponse, over HTTP/2, as every Fastify HTTP/2 route does', async () => {
        const hooks: string[] = [];
        const { promise: handlerStarted, resolve: started } = Promise.withResolvers<void>();
        const waiting = handle(getOrder, async ({ params }, { request }) => {
          started();
          await new Promise((resolve) => request.signal.addEventListener('abort', resolve));
          return success(getOrder, { id: params.orderId });
        });
        const { url } = await served({
          fastify: { http2: true },
          handlers: withEndpoints({ getOrder: waiting }),
          before: (app) =>
            app.addHook(
              'onRequestAbort',
              async (request) => void hooks.push(`abort ${request.url}`),
            ),
          after: (app) =>
            app.addHook(
              'onResponse',
              async (request) => void hooks.push(`response ${request.url}`),
            ),
        });
        const session = h2Session(url);

        const stream = session.request({ ':path': '/orders/o-1' });
        stream.on('error', () => undefined);
        await handlerStarted;
        stream.close(constants.NGHTTP2_CANCEL);
        await waitFor(200);

        expect(hooks).toEqual(['abort /orders/o-1', 'response /orders/o-1']);
      });

      test('a Handler’s signal is not aborted once its response has finished', async () => {
        const signals: AbortSignal[] = [];
        const watching = handle(getOrder, ({ params }, { request }) => {
          signals.push(request.signal);
          return success(getOrder, { id: params.orderId });
        });
        const { url } = await served({
          fastify: { http2: true },
          handlers: withEndpoints({ getOrder: watching }),
        });
        const session = h2Session(url);

        const answer = await h2(session, { ':path': '/orders/o-1' });
        await waitFor(50);

        expect(answer.status).toBe(200);
        expect(signals[0]?.aborted).toBe(false);
      });

      test('a Caller that leaves during an earlier async app onRequest hook aborts the Handler’s signal at once, and onAnswered records it', async () => {
        const startedAborted: boolean[] = [];
        const records: AnsweredRequest[] = [];
        const reading = handle(getOrder, ({ params }, { request }) => {
          startedAborted.push(request.signal.aborted);
          return success(getOrder, { id: params.orderId });
        });
        const { promise: hookRunning, resolve: running } = Promise.withResolvers<void>();
        const { url } = await served({
          fastify: { http2: true },
          handlers: withEndpoints({ getOrder: reading }),
          options: { onAnswered: (record) => void records.push(record) },
          before: (app) =>
            app.addHook('onRequest', async () => {
              running();
              await waitFor(300);
            }),
        });
        const session = h2Session(url);

        const stream = session.request({ ':path': '/orders/o-1' });
        stream.on('error', () => undefined);
        await hookRunning;
        stream.close(constants.NGHTTP2_CANCEL);
        await waitFor(600);

        expect(startedAborted).toEqual([true]);
        expect(records.map((record) => record.aborted)).toEqual([true]);
      });
    });

    test('a Success larger than the flow-control window reaches a slow-reading Caller whole, ending with END_STREAM', async () => {
      const { url } = await served({ fastify: { http2: true } });
      const wire = await framesProxy(url);
      const session = h2Session(wire.url);

      const stream = session.request({ ':path': '/report' });
      stream.pause();
      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      const ended = new Promise((resolve) => stream.on('end', resolve));
      await waitFor(300);
      stream.resume();
      await ended;
      await waitFor(50);

      expect(Buffer.concat(chunks).length).toBe(JSON.stringify({ data: bigData }).length);
      expect(wireEndOf(wire.framesOf(1))).toBe('end');
    });

    test('when something fails once a request is taken, its stream is reset with an error code, the session’s other streams and the app’s routes keep answering, and the request reaches onRequestAbort, then onResponse, since Node finishes an HTTP/2 response on every close', async () => {
      const hooks: string[] = [];
      const { url } = await served({
        fastify: { http2: true },
        before: (app) => {
          app.addHook('onRequest', async (request, reply) => {
            if (request.url.startsWith('/orders')) {
              reply.header('transfer-encoding', 'chunked');
            }
          });
          app.addHook('onRequestAbort', async (request) => void hooks.push(`abort ${request.url}`));
        },
        after: (app) =>
          app.addHook('onResponse', async (request) => void hooks.push(`response ${request.url}`)),
      });
      const session = h2Session(url);
      let failed: Awaited<ReturnType<typeof h2>> | undefined;

      const uncaught = await uncaughtDuring(async () => {
        failed = await h2(session, { ':path': '/orders/o-1' });
        await waitFor(50);
      });
      const summary = await h2(session, { ':path': '/greet?name=Bob' });
      const own = await h2(session, { ':path': '/healthz' });

      expect(failed?.ended).toBe(false);
      expect(failed?.rstCode).toBe(constants.NGHTTP2_INTERNAL_ERROR);
      expect([summary.status, own.status, own.body]).toEqual([204, 200, 'ok']);
      expect(uncaught).toEqual([]);
      expect(hooks).toEqual([
        'abort /orders/o-1',
        'response /orders/o-1',
        'response /greet?name=Bob',
        'response /healthz',
      ]);
    });

    describe('with allowHTTP1 over TLS', () => {
      const tls = selfSigned();
      const upload = JSON.stringify({ text: 'x'.repeat(300_000) });

      /** One HTTP/1.1 request over TLS to the server at `url`: its status, headers and body. */
      async function http1OverTls(url: string, path: string, body?: string) {
        const request = httpsRequest(`${url}${path}`, {
          method: body === undefined ? 'GET' : 'POST',
          ca: tls.cert,
          servername: 'localhost',
          agent: false,
          headers: { 'content-type': 'application/json' },
        });
        request.on('error', () => undefined);
        request.end(body);
        const [response] = (await once(request, 'response')) as [IncomingMessage];
        const chunks: Buffer[] = [];
        for await (const chunk of response) {
          chunks.push(chunk);
        }
        const text = Buffer.concat(chunks).toString();
        return { status: response.statusCode, headers: response.headers, body: text };
      }

      test('an HTTP/1.1 request and an HTTP/2 request are each answered by cf-loom, and a body over maxBodyBytes closes the connection over HTTP/1.1 and the stream over HTTP/2', async () => {
        const { url } = await served({
          fastify: { http2: true, https: allowingHttp1(tls) },
          options: { maxBodyBytes: 1000 },
        });
        const session = h2Session(url, tls);

        const overHttp1 = await http1OverTls(url, '/orders/o-1');
        const overHttp2 = await h2(session, { ':path': '/orders/o-1' });
        const tooLargeOverHttp1 = await http1OverTls(url, '/notes', upload);
        const tooLargeOverHttp2 = await h2(
          session,
          { ':method': 'POST', ':path': '/notes', 'content-type': 'application/json' },
          upload,
        );

        expect([overHttp1.status, overHttp1.body]).toEqual([200, '{"id":"o-1"}']);
        expect([overHttp2.status, overHttp2.body]).toEqual([200, '{"id":"o-1"}']);
        expect([tooLargeOverHttp1.status, tooLargeOverHttp1.headers.connection]).toEqual([
          413,
          'close',
        ]);
        expect(tooLargeOverHttp2).toMatchObject({ status: 413, ended: true, rstCode: 0 });
        expect(tooLargeOverHttp2.headers.connection).toBeUndefined();
      });
    });
  });
});
