import { createServer, type RequestListener, type Server, type ServerResponse } from 'node:http';
import type { Http } from '@cf-loom/contract';
import { reservedResponseOf } from '@cf-loom/contract/internal';
import { faultLineOf } from '@cf-loom/handlers/internal';
import { answeredOf } from '../answering/index.ts';
import { incomingRequestOf, incomingUrlOf, unreadableResponse } from '../incoming/index.ts';
import { respondedWith, type Taken, takenOf } from '../outgoing/index.ts';

/** The line a handler that rejects is logged on. */
const rejectedLine = faultLineOf('nodeListener', { message: 'the handler rejected' });

/**
 * Connects the handler `serve` returns to `node:http` as a request listener, for a server the
 * Service creates itself.
 */
export function nodeListener(http: Http): RequestListener {
  return (_incoming, outgoing) => {
    void respond(http, outgoing);
  };
}

/** Connects the handler `serve` returns to `node:http`: the Server to `listen()` on and `close()`. */
export function nodeHttp(http: Http): Server {
  return createServer(nodeListener(http));
}

/** Answers the request `outgoing` answers with what `http` returns, written as `outgoing` does. */
async function respond(http: Http, outgoing: ServerResponse) {
  const taken = takenOf(outgoing);
  await respondedWith(taken, answeredFor(http, taken));
}

/**
 * What answers an incoming message: `http`'s Response, `NO_SUCH_ENDPOINT` for a method a `Request`
 * refuses, which no Endpoint can have, and 400 for one that cannot be read.
 */
async function answeredFor(http: Http, { incoming, closed: signal }: Taken): Promise<Response> {
  const read = incomingUrlOf(incoming);
  if (read.kind === 'refused-method') {
    return reservedResponseOf('NO_SUCH_ENDPOINT');
  }
  const request = read.kind === 'url' ? incomingRequestOf(incoming, read.url, signal) : undefined;
  if (request === undefined) {
    return unreadableResponse();
  }
  return await answeredOf(http, request, rejectedLine);
}
