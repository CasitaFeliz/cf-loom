import {
  createServer,
  type IncomingMessage,
  type RequestListener,
  type Server,
  type ServerResponse,
} from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Http } from '@cf-loom/contract';
import { reservedResponseOf } from '@cf-loom/contract/internal';
import { faultLineOf } from '@cf-loom/handlers/internal';
import { answeredOf } from '../answering/index.ts';

/** The methods a web-standard `Request` refuses, whatever their case, so no Endpoint can have them. */
const refusedMethods: readonly string[] = ['CONNECT', 'TRACE', 'TRACK'];

/** The methods whose request never carries a body, which a web-standard `Request` refuses one for. */
const bodiless: readonly string[] = ['GET', 'HEAD'];

/** The line a handler that rejects is logged on. */
const rejectedLine = faultLineOf('nodeListener', { message: 'the handler rejected' });

/** How an incoming message reads as a web-standard request: a `Request`, or what answers it instead. */
type Incoming =
  | { readonly kind: 'request'; readonly request: Request }
  | { readonly kind: 'answered'; readonly response: Response };

/**
 * Connects the handler `serve` returns to `node:http` as a request listener, for a server the
 * Service creates itself.
 */
export function nodeListener(http: Http): RequestListener {
  return (incoming, outgoing) => {
    void respond(http, incoming, outgoing);
  };
}

/** Connects the handler `serve` returns to `node:http`: the Server to `listen()` on and `close()`. */
export function nodeHttp(http: Http): Server {
  return createServer(nodeListener(http));
}

/**
 * Answers an incoming message with what `http` returns; one answered before its body arrived whole
 * closes the connection, so a body `serve` did not read never stalls the next request.
 */
async function respond(http: Http, incoming: IncomingMessage, outgoing: ServerResponse) {
  const read = incomingOf(incoming);
  const response =
    read.kind === 'request' ? await answeredOf(http, read.request, rejectedLine) : read.response;
  if (!incoming.complete) {
    outgoing.setHeader('connection', 'close');
  }
  try {
    await written(response, outgoing);
  } catch {
    outgoing.destroy();
  }
}

/**
 * The web-standard `Request` of an incoming message: `NO_SUCH_ENDPOINT` for a method a `Request`
 * refuses, which no Endpoint can have, and 400 when its target or its `Host` names no URL.
 */
function incomingOf(incoming: IncomingMessage): Incoming {
  if (refusedMethods.includes((incoming.method ?? '').toUpperCase())) {
    return { kind: 'answered', response: reservedResponseOf('NO_SUCH_ENDPOINT') };
  }
  const url = urlOf(incoming);
  const request = url === undefined ? undefined : requestOf(incoming, url);
  if (request === undefined) {
    return { kind: 'answered', response: new Response(null, { status: 400 }) };
  }
  return { kind: 'request', request };
}

/**
 * The URL of a request target in origin form, on the origin its `Host` names, or in absolute form;
 * none for any other target, or a `Host` that is no bare host and port, so it never moves the path.
 */
function urlOf(incoming: IncomingMessage): URL | undefined {
  const target = incoming.url ?? '';
  const host = incoming.headers.host;
  if (host === undefined || !isBareHost(host)) {
    return undefined;
  }
  if (target.startsWith('/')) {
    return URL.parse(`http://${host}${target}`) ?? undefined;
  }
  const absolute = URL.parse(target);
  const isHttp = absolute?.protocol === 'http:' || absolute?.protocol === 'https:';
  const hasCredentials = absolute?.username !== '' || absolute?.password !== '';
  return isHttp && !hasCredentials ? absolute : undefined;
}

/** Whether a `Host` header is a host and an optional port, and nothing a URL would read as more. */
function isBareHost(host: string): boolean {
  return !/[\s/\\?#@]/.test(host) && URL.canParse(`http://${host}`);
}

/**
 * The `Request` of an incoming message on its URL, or none when a `Request` refuses what Node
 * accepted, so nothing it is given throws past the listener.
 */
function requestOf(incoming: IncomingMessage, url: URL): Request | undefined {
  try {
    return newRequestOf(incoming, url);
  } catch {
    return undefined;
  }
}

function newRequestOf(incoming: IncomingMessage, url: URL): Request {
  const headers = new Headers();
  for (let index = 0; index + 1 < incoming.rawHeaders.length; index += 2) {
    headers.append(incoming.rawHeaders[index] ?? '', incoming.rawHeaders[index + 1] ?? '');
  }
  const method = incoming.method ?? 'GET';
  if (bodiless.includes(method)) {
    return new Request(url, { method, headers });
  }
  const body = Readable.toWeb(incoming) as ReadableStream<Uint8Array>;
  return new Request(url, { method, headers, body, duplex: 'half' } as RequestInit);
}

/** Writes a `Response` to the outgoing message: its status, headers and body. */
async function written(response: Response, outgoing: ServerResponse) {
  outgoing.statusCode = response.status;
  for (const [name, value] of response.headers) {
    outgoing.appendHeader(name, value);
  }
  if (response.body === null) {
    outgoing.end();
    return;
  }
  await pipeline(Readable.fromWeb(response.body as never), outgoing);
}
