import type { IncomingMessage } from 'node:http';
import { Http2ServerRequest } from 'node:http2';
import { Readable } from 'node:stream';

/** The methods a web-standard `Request` refuses, whatever their case, so no Endpoint can have them. */
const refusedMethods: readonly string[] = ['CONNECT', 'TRACE', 'TRACK'];

/** The methods whose request never carries a body, which a web-standard `Request` refuses one for. */
const bodiless: readonly string[] = ['GET', 'HEAD'];

/** A request as Node hands it over HTTP/1.1 or over HTTP/2. */
export type Incoming = IncomingMessage | Http2ServerRequest;

/** How an incoming message reads as a URL: the URL, or why it is none. */
export type IncomingUrl =
  | { readonly kind: 'url'; readonly url: URL }
  | { readonly kind: 'refused-method' }
  | { readonly kind: 'unreadable' };

/** The URL of an incoming message by one set of rules for every host, or why it has none. */
export function incomingUrlOf(incoming: Incoming): IncomingUrl {
  if (refusedMethods.includes((incoming.method ?? '').toUpperCase())) {
    return { kind: 'refused-method' };
  }
  const url = urlOf(incoming);
  return url === undefined ? { kind: 'unreadable' } : { kind: 'url', url };
}

/**
 * The `Request` of an incoming message on its URL, or none when a `Request` refuses what Node
 * accepted, so nothing it is given throws past the adapter.
 */
export function incomingRequestOf(
  incoming: Incoming,
  url: URL,
  signal: AbortSignal,
): Request | undefined {
  try {
    return newRequestOf(incoming, url, signal);
  } catch {
    return undefined;
  }
}

/** What answers a request that cannot be read as a web-standard one: 400. */
export function unreadableResponse(): Response {
  return new Response(null, { status: 400 });
}

/** The URL of a request by its version's target: HTTP/2's pseudo-headers, else HTTP/1.1's target. */
function urlOf(incoming: Incoming): URL | undefined {
  if (incoming instanceof Http2ServerRequest) {
    return pseudoTargetUrlOf(incoming);
  }
  return targetUrlOf(incoming);
}

/**
 * The URL of a request target in origin form, on the origin its `Host` names, or in absolute form;
 * none for any other target, or a `Host` that is no bare host and port, so it never moves the path.
 */
function targetUrlOf(incoming: IncomingMessage): URL | undefined {
  const target = incoming.url ?? '';
  const host = incoming.headers.host;
  if (host === undefined || !isBareHost(host)) {
    return undefined;
  }
  if (target.startsWith('/')) {
    return URL.parse(`http://${host}${target}`) ?? undefined;
  }
  return absoluteUrlOf(target);
}

/**
 * The URL of an HTTP/2 request: the absolute-form target its `:scheme`, its authority and its path
 * make, read by the absolute-form rule, and none for a path that is not one, such as `*`.
 */
function pseudoTargetUrlOf(incoming: Http2ServerRequest): URL | undefined {
  const authority: string | undefined = incoming.authority;
  if (authority === undefined || !isBareHost(authority) || !incoming.url.startsWith('/')) {
    return undefined;
  }
  return absoluteUrlOf(`${incoming.headers[':scheme']}://${authority}${incoming.url}`);
}

/** The URL of an absolute-form target with an `http` or `https` scheme and no credentials, or none. */
function absoluteUrlOf(target: string): URL | undefined {
  const absolute = URL.parse(target);
  const isHttp = absolute?.protocol === 'http:' || absolute?.protocol === 'https:';
  const hasCredentials = absolute?.username !== '' || absolute?.password !== '';
  return isHttp && !hasCredentials ? absolute : undefined;
}

/** Whether a `Host` header is a host and an optional port, and nothing a URL would read as more. */
function isBareHost(host: string): boolean {
  return !/[\s/\\?#@]/.test(host) && URL.canParse(`http://${host}`);
}

function newRequestOf(incoming: Incoming, url: URL, signal: AbortSignal): Request {
  const headers = new Headers();
  for (let index = 0; index + 1 < incoming.rawHeaders.length; index += 2) {
    const name = incoming.rawHeaders[index] ?? '';
    if (!name.startsWith(':')) {
      headers.append(name, incoming.rawHeaders[index + 1] ?? '');
    }
  }
  const method = incoming.method ?? 'GET';
  if (bodiless.includes(method)) {
    return new Request(url, { method, headers, signal });
  }
  const body = Readable.toWeb(incoming) as ReadableStream<Uint8Array>;
  return new Request(url, { method, headers, body, duplex: 'half', signal } as RequestInit);
}
