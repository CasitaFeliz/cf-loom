import type { IncomingMessage, ServerResponse } from 'node:http';
import { type Http2ServerRequest, Http2ServerResponse, type ServerHttp2Stream } from 'node:http2';
import { closedDepartureOf, type Departure, resetDepartureOf } from '../departure/index.ts';

/** The headers a host set on a request before it was taken. */
type HostHeaders = Readonly<Record<string, number | string | string[] | undefined>>;

/** A request and the response to answer it on, both of one protocol. */
type Exchange =
  | { readonly incoming: IncomingMessage; readonly outgoing: ServerResponse }
  | { readonly incoming: Http2ServerRequest; readonly outgoing: Http2ServerResponse };

/** A request taken from its host: the messages to answer it on, the Caller's departure, and the headers the host set before. */
export type Taken = Exchange &
  Departure & {
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
 * The request a response answers, taken from its host, with its protocol's steps and the Caller's
 * departure, read from the class of the response, since a server that allows HTTP/1.1 beside
 * HTTP/2 mixes the two.
 */
export function takenOf(
  outgoing: ServerResponse | Http2ServerResponse,
  hostHeaders: HostHeaders = {},
): Taken {
  if (outgoing instanceof Http2ServerResponse) {
    const { req: incoming, stream } = outgoing;
    const protocol = http2Of(incoming, outgoing);
    return { incoming, outgoing, ...resetDepartureOf(stream), hostHeaders, protocol };
  }
  const { req: incoming } = outgoing;
  const protocol = http1Of(incoming, outgoing);
  return { incoming, outgoing, ...closedDepartureOf(outgoing), hostHeaders, protocol };
}

/**
 * HTTP/1.1's steps: a stated length that does not match the body destroys the socket,
 * `connection: close` when the request's body did not arrive whole, and the socket destroyed on
 * failure.
 */
function http1Of(incoming: IncomingMessage, outgoing: ServerResponse): Protocol {
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
 * HTTP/2's steps: a body read in part whose Caller has not sent its END_STREAM, as one over
 * `maxBodyBytes`, cut off by resetting the stream with `NO_ERROR` once the response's END_STREAM
 * is sent, and the stream reset with an error on failure. Node itself ends a stream whose body
 * nobody read.
 */
function http2Of(incoming: Http2ServerRequest, outgoing: Http2ServerResponse): Protocol {
  const { stream } = outgoing;
  return {
    framed: () => undefined,
    ended: () => {
      const cut = incoming.readableDidRead && stream.state.remoteClose !== 1;
      outgoing.end();
      if (cut) {
        resetOnceEnded(stream);
      }
    },
    failed: () => stream.destroy(new Error('the response could not be written')),
  };
}

/** Whether a request's body was read, but not to its end, so Node leaves its connection open. */
function isReadInPart(incoming: IncomingMessage): boolean {
  return incoming.readableDidRead && !incoming.readableEnded;
}

/**
 * Resets a stream with `NO_ERROR` once its END_STREAM is on the wire, which Node marks in the
 * stream's state and announces by no event, so it is polled, backing off to once a second while
 * the Caller's window holds the response back, until the stream closes.
 */
function resetOnceEnded(stream: ServerHttp2Stream): void {
  if (stream.closed || stream.destroyed) {
    return;
  }
  let delay = 1;
  const check = () => {
    if (stream.state.localClose === 1) {
      stream.destroy();
      return;
    }
    timer = setTimeout(check, delay);
    delay = Math.min(delay * 2, 1000);
  };
  let timer = setTimeout(check, 0);
  stream.once('close', () => clearTimeout(timer));
}
