import type { IncomingMessage } from 'node:http';
import type { Http2ServerRequest } from 'node:http2';

/** What a body's next read finds on its request: a chunk, the end, or why it failed. */
type Pulled =
  | { readonly kind: 'chunk'; readonly chunk: Uint8Array }
  | { readonly kind: 'end' }
  | { readonly kind: 'failed'; readonly error: unknown };

/**
 * The body of an incoming message as a web stream that reads the message only when it is read, a
 * chunk per read, so a body nobody reads stays Node's, which ends the exchange as for its own
 * routes: it discards the body over HTTP/1.1 and resets the stream after the response over HTTP/2.
 * A cancel leaves the message as it is, and the writer ends a body read only in part.
 */
export function lazyBodyOf(
  incoming: IncomingMessage | Http2ServerRequest,
): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>(
    {
      pull: async (controller) => {
        const pulled = await pulledFrom(incoming);
        switch (pulled.kind) {
          case 'chunk':
            controller.enqueue(pulled.chunk);
            return;
          case 'end':
            controller.close();
            return;
          case 'failed':
            controller.error(pulled.error);
            return;
        }
      },
    },
    { highWaterMark: 0 },
  );
}

/** The message's next chunk, waiting for one when none is buffered. */
async function pulledFrom(incoming: IncomingMessage | Http2ServerRequest): Promise<Pulled> {
  for (;;) {
    const chunk: Buffer | null = incoming.read();
    if (chunk !== null) {
      return { kind: 'chunk', chunk: new Uint8Array(chunk) };
    }
    if (incoming.readableEnded) {
      return { kind: 'end' };
    }
    if (incoming.destroyed) {
      return { kind: 'failed', error: incoming.errored ?? new Error('the request closed early') };
    }
    await readableAgain(incoming);
  }
}

/** Waits until the message has a chunk, has ended, failed or closed. */
function readableAgain(incoming: IncomingMessage | Http2ServerRequest): Promise<void> {
  return new Promise((resolve) => {
    const events = ['readable', 'end', 'error', 'close'] as const;
    const settled = () => {
      for (const event of events) {
        incoming.off(event, settled);
      }
      resolve();
    };
    for (const event of events) {
      incoming.on(event, settled);
    }
  });
}
