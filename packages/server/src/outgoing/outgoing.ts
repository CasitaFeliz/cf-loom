import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

/**
 * Writes a `Response` to the outgoing message: its status, headers and body. One answered before
 * the request's body arrived whole closes the connection, so a body `serve` did not read never
 * stalls the next request; a body that fails while written destroys the socket.
 */
export async function respondedWith(
  incoming: IncomingMessage,
  outgoing: ServerResponse,
  response: Response,
): Promise<void> {
  if (!incoming.complete) {
    outgoing.setHeader('connection', 'close');
  }
  try {
    await written(response, outgoing);
  } catch {
    outgoing.destroy();
  }
}

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
