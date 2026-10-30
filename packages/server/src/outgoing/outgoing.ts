import { once } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';

/** A request taken from its host: the messages to answer it on, the Caller's departure, and the headers the host set before. */
export type Taken = {
  readonly incoming: IncomingMessage;
  readonly outgoing: ServerResponse;
  /** Aborts when the Caller is gone before the response finished, which stops the body being read or written. */
  readonly closed: AbortSignal;
  /** The host's headers, which the Response's replace; a `content-length`, the host's or already on `outgoing`, frames a body that is not the Response's, so it is dropped. */
  readonly hostHeaders?: Readonly<Record<string, number | string | string[] | undefined>>;
};

/** The reader of a Response's body, whose chunks are bytes. */
type BodyReader = ReadableStreamDefaultReader<Uint8Array>;

/**
 * Writes the Response `answer` resolves to onto a taken request, and destroys its socket if
 * anything fails on the way, so such a request never crashes the process or leaves its Caller
 * waiting.
 */
export async function respondedWith(taken: Taken, answer: Promise<Response>): Promise<void> {
  const { outgoing, closed } = taken;
  try {
    const response = await answer;
    const reader = response.body?.getReader();
    cancelledWhenClosed(reader, closed);
    outgoing.strictContentLength = true;
    headWritten(taken, response);
    await bodyWritten(taken, reader);
  } catch {
    outgoing.destroy();
  }
}

function cancelledWhenClosed(reader: BodyReader | undefined, closed: AbortSignal) {
  if (reader === undefined) {
    return;
  }
  const cancel = () => void reader.cancel().catch(() => undefined);
  if (closed.aborted) {
    cancel();
  } else {
    closed.addEventListener('abort', cancel, { once: true });
  }
}

function headWritten({ incoming, outgoing, hostHeaders = {} }: Taken, response: Response) {
  outgoing.statusCode = response.status;
  for (const [name, value] of Object.entries(hostHeaders)) {
    if (value !== undefined) {
      outgoing.setHeader(name, value);
    }
  }
  outgoing.removeHeader('content-length');
  const named = new Set<string>();
  for (const [name, value] of response.headers) {
    if (named.has(name)) {
      outgoing.appendHeader(name, value);
    } else {
      outgoing.setHeader(name, value);
      named.add(name);
    }
  }
  if (!incoming.complete) {
    outgoing.setHeader('connection', 'close');
  }
}

async function bodyWritten({ outgoing, closed }: Taken, reader: BodyReader | undefined) {
  if (reader === undefined) {
    outgoing.end();
    return;
  }
  for (let read = await reader.read(); !read.done; read = await reader.read()) {
    if (!outgoing.write(read.value)) {
      await once(outgoing, 'drain', { signal: closed });
    }
  }
  outgoing.end();
}
