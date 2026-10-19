import {
  createServer,
  type IncomingMessage,
  type RequestListener,
  type Server,
  type ServerResponse,
} from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Http } from '../answering/index.ts';
import { reservedResponseOf } from '../response/index.ts';

/** The methods whose request never carries a body, which a web-standard `Request` refuses one for. */
const bodiless: readonly string[] = ['GET', 'HEAD'];

/** How an incoming message reads as a web-standard request: a `Request`, or what answers it instead. */
type Incoming =
  | { readonly kind: 'request'; readonly request: Request }
  | { readonly kind: 'answered'; readonly response: Response };

/**
 * Connects the handler `serve` returns to `node:http` as a request listener, for a server the
 * Service creates itself; what `http` rejects with, a hook's throw, reaches the process. The URL
 * it builds is always `http://`, which is harmless: `serve` reads only its path and query.
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

async function respond(http: Http, incoming: IncomingMessage, outgoing: ServerResponse) {
  const read = incomingOf(incoming);
  const response = read.kind === 'request' ? await http(read.request) : read.response;
  try {
    await written(response, incoming, outgoing);
  } catch {
    outgoing.destroy();
  }
}

/**
 * The web-standard `Request` of an incoming message: 400 when its target is no path or its `Host`
 * names no URL, and `NO_SUCH_ENDPOINT` for a method a `Request` refuses, which no Endpoint has.
 */
function incomingOf(incoming: IncomingMessage): Incoming {
  const url = urlOf(incoming);
  if (url === undefined) {
    return { kind: 'answered', response: new Response(null, { status: 400 }) };
  }
  try {
    return { kind: 'request', request: requestOf(incoming, url) };
  } catch {
    return { kind: 'answered', response: reservedResponseOf('NO_SUCH_ENDPOINT') };
  }
}

/** The URL of a request target that is a path, on the origin its `Host` names; none otherwise. */
function urlOf(incoming: IncomingMessage): URL | undefined {
  const target = incoming.url ?? '';
  const host = incoming.headers.host;
  if (!target.startsWith('/') || host === undefined) {
    return undefined;
  }
  return URL.parse(`http://${host}${target}`) ?? undefined;
}

function requestOf(incoming: IncomingMessage, url: URL): Request {
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

/** Writes a `Response` to the outgoing message: its status, headers and body, none for `HEAD`. */
async function written(response: Response, incoming: IncomingMessage, outgoing: ServerResponse) {
  outgoing.statusCode = response.status;
  for (const [name, value] of response.headers) {
    outgoing.appendHeader(name, value);
  }
  if (response.body === null || incoming.method === 'HEAD') {
    outgoing.end();
    return;
  }
  await pipeline(Readable.fromWeb(response.body as never), outgoing);
}
