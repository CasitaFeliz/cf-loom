import { once } from 'node:events';
import type { Taken } from './taken.ts';

/** The reader of a Response's body, whose chunks are bytes. */
type BodyReader = ReadableStreamDefaultReader<Uint8Array>;

/** What a body is written to, a response of either version. */
type BodySink = NodeJS.EventEmitter & { write(chunk: Uint8Array): boolean };

/**
 * Writes the Response `answer` resolves to onto a taken request, and fails the exchange as its
 * version does if anything fails on the way, so such a request never crashes the process or leaves
 * its Caller waiting.
 */
export async function respondedWith(taken: Taken, answer: Promise<Response>): Promise<void> {
  try {
    const response = await answer;
    const reader = response.body?.getReader();
    cancelledWhenClosed(reader, taken.closed);
    headWritten(taken, response);
    taken.version.framed();
    await bodyWritten(taken, reader);
  } catch {
    taken.version.failed();
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

function headWritten({ outgoing, hostHeaders }: Taken, response: Response) {
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
}

async function bodyWritten({ outgoing, closed, version }: Taken, reader: BodyReader | undefined) {
  if (reader === undefined) {
    version.ended();
    return;
  }
  const sink: BodySink = outgoing;
  for (let read = await reader.read(); !read.done; read = await reader.read()) {
    if (!sink.write(read.value)) {
      await once(sink, 'drain', { signal: closed });
    }
  }
  version.ended();
}
