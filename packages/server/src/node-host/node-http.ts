import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Http } from '../answering/index.ts';

/** The methods whose request never carries a body, which a web-standard `Request` refuses one for. */
const bodiless: readonly string[] = ['GET', 'HEAD'];

/**
 * Connects the handler `serve` returns to `node:http` as a request listener, for a server the
 * Service creates itself; what `http` rejects with, a hook's throw, reaches the process.
 */
export function nodeListener(
  http: Http,
): (request: IncomingMessage, response: ServerResponse) => void {
  return (request, response) => {
    void respond(http, request, response);
  };
}

/** Connects the handler `serve` returns to `node:http`: the Server to `listen()` on and `close()`. */
export function nodeHttp(http: Http): Server {
  return createServer(nodeListener(http));
}

async function respond(http: Http, incoming: IncomingMessage, outgoing: ServerResponse) {
  const request = requestOf(incoming);
  if (request === undefined) {
    outgoing.writeHead(400).end();
    return;
  }
  const response = await http(request);
  try {
    await written(response, incoming, outgoing);
  } catch {
    outgoing.destroy();
  }
}

/** The web-standard `Request` of an incoming message; none when its `Host` names no URL. */
function requestOf(incoming: IncomingMessage): Request | undefined {
  const host = incoming.headers.host;
  const url = host === undefined ? null : URL.parse(incoming.url ?? '/', `http://${host}`);
  if (url === null) {
    return undefined;
  }
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
