import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Writes a `Response` to the outgoing message: its status and headers, each replacing one the host
 * set before, and its body. A body that ends in its first chunk is sent in one piece with its
 * `content-length`; one that streams, as it streams. A response sent before the request's body
 * arrived whole closes the connection, and a body that fails while written destroys the socket.
 */
export async function respondedWith(
  incoming: IncomingMessage,
  outgoing: ServerResponse,
  response: Response,
): Promise<void> {
  outgoing.statusCode = response.status;
  setHeadersOf(outgoing, response.headers);
  if (!incoming.complete) {
    outgoing.setHeader('connection', 'close');
  }
  if (response.body === null) {
    outgoing.end();
    return;
  }
  const reader = response.body.getReader();
  outgoing.once('close', () => void reader.cancel().catch(() => undefined));
  try {
    await bodyWritten(outgoing, reader);
  } catch {
    outgoing.destroy();
  }
}

/** Writes each header: the first value of a name replaces the one the host set, later ones are added. */
function setHeadersOf(outgoing: ServerResponse, headers: Headers) {
  const named = new Set<string>();
  for (const [name, value] of headers) {
    if (named.has(name)) {
      outgoing.appendHeader(name, value);
    } else {
      outgoing.setHeader(name, value);
      named.add(name);
    }
  }
}

/** A chunk read from a body, or its end. */
type Read = Awaited<ReturnType<ReadableStreamDefaultReader<Uint8Array>['read']>>;

/** What a body streams to `outgoing`, or sends in one piece when its first chunk is also its last. */
async function bodyWritten(
  outgoing: ServerResponse,
  reader: ReadableStreamDefaultReader<Uint8Array>,
) {
  const first = await reader.read();
  if (first.done) {
    outgoing.end();
    return;
  }
  const following = reader.read();
  const second = await Promise.race([following, nextTurn()]);
  if (second?.done) {
    outgoing.setHeader('content-length', first.value.byteLength);
    outgoing.end(first.value);
    return;
  }
  await accepted(outgoing, first.value);
  await streamed(outgoing, reader, second ?? following);
}

/** The end of this turn of the event loop, by which a body built in memory has produced its end. */
function nextTurn(): Promise<undefined> {
  return new Promise((resolve) => setImmediate(() => resolve(undefined)));
}

async function streamed(
  outgoing: ServerResponse,
  reader: ReadableStreamDefaultReader<Uint8Array>,
  following: Read | Promise<Read>,
) {
  for (let read = await following; !read.done; read = await reader.read()) {
    await accepted(outgoing, read.value);
  }
  outgoing.end();
}

async function accepted(outgoing: ServerResponse, chunk: Uint8Array) {
  if (outgoing.write(chunk)) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    if (outgoing.destroyed) {
      reject(new Error('the response closed before its body was written'));
      return;
    }
    const onDrain = () => {
      outgoing.off('close', onClose);
      resolve();
    };
    const onClose = () => {
      outgoing.off('drain', onDrain);
      reject(new Error('the response closed before its body was written'));
    };
    outgoing.once('drain', onDrain);
    outgoing.once('close', onClose);
  });
}
