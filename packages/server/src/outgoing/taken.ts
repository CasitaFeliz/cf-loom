import type { IncomingMessage, ServerResponse } from 'node:http';
import { type Http2ServerRequest, Http2ServerResponse } from 'node:http2';

/** The headers a host set on a request before it was taken. */
type HostHeaders = Readonly<Record<string, number | string | string[] | undefined>>;

/** A request taken from its host: the messages to answer it on, the Caller's departure, and the headers the host set before. */
export type Taken = {
  readonly incoming: IncomingMessage | Http2ServerRequest;
  readonly outgoing: ServerResponse | Http2ServerResponse;
  /** Aborts when the Caller is gone before the response finished, which stops the body being read or written. */
  readonly closed: AbortSignal;
  /** The host's headers, which the Response's replace; a `content-length`, the host's or already on `outgoing`, frames a body that is not the Response's, so it is dropped. */
  readonly hostHeaders: HostHeaders;
  /** The writer's steps the request's HTTP version decides, chosen once when it is taken. */
  readonly version: Version;
};

/** The steps of writing a response that differ between HTTP/1.1 and HTTP/2. */
type Version = {
  /** Readies the response, its head set, for a body Node frames. */
  readonly framed: () => void;
  /** Ends the response once its body is written. */
  readonly ended: () => void;
  /** Ends the exchange once anything failed, so the Caller never takes a cut-off body for a whole one. */
  readonly failed: () => void;
};

/**
 * A request taken from its host, with its version's steps and the Caller's departure, read from
 * the class of its response since a server that allows HTTP/1.1 beside HTTP/2 mixes the two.
 */
export function takenOf(
  incoming: IncomingMessage | Http2ServerRequest,
  outgoing: ServerResponse | Http2ServerResponse,
  hostHeaders: HostHeaders = {},
): Taken {
  if (outgoing instanceof Http2ServerResponse) {
    const version = http2Of(outgoing);
    return { incoming, outgoing, closed: new AbortController().signal, hostHeaders, version };
  }
  const version = http1Of(incoming, outgoing);
  return { incoming, outgoing, closed: closedSignalOf(outgoing), hostHeaders, version };
}

/**
 * HTTP/1.1's steps: a stated length that does not match the body destroys the socket,
 * `connection: close` when the request's body did not arrive whole, and the socket destroyed on
 * failure.
 */
function http1Of(
  incoming: IncomingMessage | Http2ServerRequest,
  outgoing: ServerResponse,
): Version {
  return {
    framed: () => {
      outgoing.strictContentLength = true;
      if (!incoming.complete) {
        outgoing.setHeader('connection', 'close');
      }
    },
    ended: () => outgoing.end(),
    failed: () => outgoing.destroy(),
  };
}

/**
 * HTTP/2's steps: the stream closed once the response is flushed when its request side has not
 * ended, so a body nobody read never leaves it half-open, and reset with an error on failure.
 */
function http2Of(outgoing: Http2ServerResponse): Version {
  return {
    framed: () => undefined,
    ended: () => outgoing.end(),
    failed: () => outgoing.destroy(),
  };
}

/**
 * The Caller's departure over HTTP/1.1: aborted at once when the response is already closed
 * unfinished, else when it closes so.
 */
function closedSignalOf(outgoing: ServerResponse): AbortSignal {
  if (outgoing.destroyed && !outgoing.writableFinished) {
    return AbortSignal.abort();
  }
  const controller = new AbortController();
  outgoing.once('close', () => {
    if (!outgoing.writableFinished) {
      controller.abort();
    }
  });
  return controller.signal;
}
