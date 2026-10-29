import type { IncomingMessage, ServerResponse } from 'node:http';

/** A request taken from its host: the messages to answer it on, and the headers the host set before. */
export type Taken = {
  readonly incoming: IncomingMessage;
  readonly outgoing: ServerResponse;
  /** The host's headers, which the Response's replace; its `content-length` frames a body that is not the Response's, so it is dropped. */
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
  const { outgoing } = taken;
  try {
    const response = await answer;
    const reader = response.body?.getReader();
    outgoing.once('close', () => void reader?.cancel().catch(() => undefined));
    outgoing.strictContentLength = true;
    headWritten(taken, response);
    await bodyWritten(outgoing, reader);
  } catch {
    outgoing.destroy();
  }
}

function headWritten({ incoming, outgoing, hostHeaders = {} }: Taken, response: Response) {
  outgoing.statusCode = response.status;
  for (const [name, value] of Object.entries(hostHeaders)) {
    if (value !== undefined && name !== 'content-length') {
      outgoing.setHeader(name, value);
    }
  }
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

async function bodyWritten(outgoing: ServerResponse, reader: BodyReader | undefined) {
  if (reader === undefined) {
    outgoing.end();
    return;
  }
  for (let read = await reader.read(); !read.done; read = await reader.read()) {
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
