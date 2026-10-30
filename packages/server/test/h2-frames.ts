import { type AddressInfo, connect, createServer, type Server } from 'node:net';

/** The frames a server sent on each of its streams, as a proxy in front of it read them. */
export type FrameLog = {
  /** The proxy's URL, to which an HTTP/2 Caller connects in place of the server's. */
  readonly url: string;
  /** The frames sent on one stream: `HEADERS`, `DATA`, either with `+END` once END_STREAM is set, and `RST(code)`. */
  readonly framesOf: (streamId: number) => readonly string[];
};

const proxies: Server[] = [];

/**
 * A plain TCP proxy in front of the h2c server at `url` that reads the frames the server sends,
 * since an HTTP/2 client takes a reset with `NO_ERROR` for a whole response as well.
 */
export async function framesProxy(url: string): Promise<FrameLog> {
  const { port } = new URL(url);
  const framesById = new Map<number, string[]>();
  const proxy = createServer((caller) => {
    const server = connect(Number(port), '127.0.0.1');
    let pending: Buffer = Buffer.alloc(0);
    caller.pipe(server);
    server.on('data', (chunk: Buffer) => {
      caller.write(chunk);
      pending = framesRead(Buffer.concat([pending, chunk]), framesById);
    });
    server.on('error', () => caller.destroy());
    caller.on('error', () => server.destroy());
    server.on('close', () => caller.destroy());
    caller.on('close', () => server.destroy());
  });
  proxies.push(proxy);
  await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve));
  const { port: proxyPort } = proxy.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${proxyPort}`,
    framesOf: (streamId) => framesById.get(streamId) ?? [],
  };
}

/** Closes every proxy `framesProxy` started. */
export function closeFrameProxies(): void {
  for (const proxy of proxies.splice(0)) {
    proxy.close();
  }
}

/**
 * How a stream's response ended on the wire: `end` when END_STREAM was sent and no reset,
 * `end, then RST(code)` when a reset followed it, and `RST(code)` or `open` without END_STREAM.
 */
export function wireEndOf(frames: readonly string[]): string {
  const ended = frames.findIndex((frame) => frame.endsWith('+END'));
  const reset = frames.find((frame) => frame.startsWith('RST'));
  if (ended === -1) {
    return reset ?? 'open';
  }
  const resetAfter = frames.slice(ended).find((frame) => frame.startsWith('RST'));
  if (reset !== undefined && resetAfter === undefined) {
    return reset;
  }
  return resetAfter === undefined ? 'end' : `end, then ${resetAfter}`;
}

/** Reads every whole frame in `received` into `framesById`, and returns the bytes left over. */
function framesRead(received: Buffer, framesById: Map<number, string[]>): Buffer {
  let rest = received;
  while (rest.length >= 9 && rest.length >= 9 + rest.readUIntBE(0, 3)) {
    const length = rest.readUIntBE(0, 3);
    const streamId = rest.readUInt32BE(5) & 0x7fffffff;
    const frame = frameNameOf(rest.subarray(0, 9 + length));
    if (streamId !== 0 && frame !== undefined) {
      framesById.set(streamId, [...(framesById.get(streamId) ?? []), frame]);
    }
    rest = rest.subarray(9 + length);
  }
  return rest;
}

/** The name of a DATA, HEADERS or RST_STREAM frame; none for any other. */
function frameNameOf(frame: Buffer): string | undefined {
  const type = frame[3];
  const end = ((frame[4] ?? 0) & 1) === 1 ? '+END' : '';
  switch (type) {
    case 0:
      return `DATA${end}`;
    case 1:
      return `HEADERS${end}`;
    case 3:
      return `RST(${frame.readUInt32BE(9)})`;
    default:
      return undefined;
  }
}
