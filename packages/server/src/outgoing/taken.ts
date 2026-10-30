import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  constants,
  type Http2ServerRequest,
  Http2ServerResponse,
  type ServerHttp2Stream,
} from 'node:http2';

/** The headers a host set on a request before it was taken. */
type HostHeaders = Readonly<Record<string, number | string | string[] | undefined>>;

/** A request taken from its host: the messages to answer it on, the Caller's departure, and the headers the host set before. */
export type Taken = {
  readonly incoming: IncomingMessage | Http2ServerRequest;
  readonly outgoing: ServerResponse | Http2ServerResponse;
  /** Aborts when the Caller is gone before the response finished; every part of the request that must stop derives from it. */
  readonly closed: AbortSignal;
  /** The host's headers, which the Response's replace; a `content-length`, the host's or already on `outgoing`, frames a body that is not the Response's, so it is dropped. */
  readonly hostHeaders: HostHeaders;
  /** The writer's steps the request's protocol decides, HTTP/1.1 or HTTP/2, chosen once when it is taken. */
  readonly protocol: Protocol;
};

/** The steps of writing a response that differ between HTTP/1.1 and HTTP/2. */
type Protocol = {
  /** Readies the response, its head set, for a body Node frames. */
  readonly framed: () => void;
  /** Ends the response once its body is written. */
  readonly ended: () => void;
  /** Ends the exchange once anything failed, so the Caller never takes a cut-off body for a whole one. */
  readonly failed: () => void;
};

/**
 * A request taken from its host, with its protocol's steps and the Caller's departure, read from
 * the class of its response, since a server that allows HTTP/1.1 beside HTTP/2 mixes the two.
 */
export function takenOf(
  incoming: IncomingMessage | Http2ServerRequest,
  outgoing: ServerResponse | Http2ServerResponse,
  hostHeaders: HostHeaders = {},
): Taken {
  if (outgoing instanceof Http2ServerResponse) {
    const protocol = http2Of(outgoing.req, outgoing);
    return { incoming, outgoing, closed: resetSignalOf(outgoing.stream), hostHeaders, protocol };
  }
  const protocol = http1Of(incoming, outgoing);
  return { incoming, outgoing, closed: closedSignalOf(outgoing), hostHeaders, protocol };
}

/**
 * HTTP/1.1's steps: a stated length that does not match the body destroys the socket,
 * `connection: close` when the request's body did not arrive whole, and the socket destroyed on
 * failure.
 */
function http1Of(
  incoming: IncomingMessage | Http2ServerRequest,
  outgoing: ServerResponse,
): Protocol {
  return {
    framed: () => {
      outgoing.strictContentLength = true;
      if (isReadInPart(incoming)) {
        outgoing.setHeader('connection', 'close');
      }
    },
    ended: () => outgoing.end(),
    failed: () => outgoing.destroy(),
  };
}

/**
 * HTTP/2's steps: a body read only in part, as one over `maxBodyBytes`, cut off by resetting the
 * stream with `NO_ERROR` once the response's END_STREAM is sent, and the stream reset with an
 * error on failure. Node itself ends a stream whose body nobody read.
 */
function http2Of(incoming: Http2ServerRequest, outgoing: Http2ServerResponse): Protocol {
  const { stream } = outgoing;
  return {
    framed: () => undefined,
    ended: () => {
      outgoing.end();
      if (isReadInPart(incoming)) {
        resetOnceEnded(stream);
      }
    },
    failed: () => stream.destroy(new Error('the response could not be written')),
  };
}

/** Whether a request's body was read, but not to its end, so Node leaves its exchange open. */
function isReadInPart(incoming: IncomingMessage | Http2ServerRequest): boolean {
  return incoming.readableDidRead && !incoming.readableEnded;
}

/**
 * Resets a stream with `NO_ERROR` once its END_STREAM is on the wire, which Node marks in the
 * stream's state and announces by no event, so it is polled.
 */
function resetOnceEnded(stream: ServerHttp2Stream): void {
  if (stream.destroyed) {
    return;
  }
  if (stream.state.localClose === 1) {
    stream.destroy();
    return;
  }
  setTimeout(() => resetOnceEnded(stream), 1);
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

/**
 * The Caller's departure over HTTP/2: aborted when the stream is, by a reset or a lost connection
 * before the response ended, or when it closes with an error code.
 */
function resetSignalOf(stream: ServerHttp2Stream): AbortSignal {
  if (stream.aborted || (stream.closed && isReset(stream))) {
    return AbortSignal.abort();
  }
  const controller = new AbortController();
  stream.once('aborted', () => controller.abort());
  stream.once('close', () => {
    if (isReset(stream)) {
      controller.abort();
    }
  });
  return controller.signal;
}

function isReset(stream: ServerHttp2Stream): boolean {
  return stream.rstCode !== constants.NGHTTP2_NO_ERROR;
}
