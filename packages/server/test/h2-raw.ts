import { connect, type Socket } from 'node:net';
import { framesRead } from './h2-frames.ts';

/** An h2c Caller that writes frames as given, so a test can send what Node's client never sends. */
export type RawCaller = {
  /** Writes frames to the server. */
  readonly send: (...frames: readonly Buffer[]) => void;
  /** The frames the server sent on one stream, named as `framesProxy` names them. */
  readonly framesOf: (streamId: number) => readonly string[];
  /** Drops the connection with no GOAWAY, as a Caller whose connection is lost. */
  readonly drop: () => void;
};

const sockets: Socket[] = [];

/**
 * Opens an h2c connection to the server at `url` and sends the preface and its SETTINGS, with
 * `window` as its initial stream window when given.
 */
export function rawCaller(url: string, options: { readonly window?: number } = {}): RawCaller {
  const socket = connect(Number(new URL(url).port), '127.0.0.1');
  socket.on('error', () => undefined);
  sockets.push(socket);
  const framesById = new Map<number, string[]>();
  let pending: Buffer = Buffer.alloc(0);
  socket.on('data', (chunk: Buffer) => {
    pending = framesRead(Buffer.concat([pending, chunk]), framesById);
  });
  socket.write('PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n');
  socket.write(frameOf({ type: 4, flags: 0, streamId: 0 }, settingsOf(options.window)));
  socket.write(frameOf({ type: 4, flags: 1, streamId: 0 }));
  return {
    send: (...sent) => void socket.write(Buffer.concat(sent)),
    framesOf: (streamId) => framesById.get(streamId) ?? [],
    drop: () => void socket.destroy(),
  };
}

/** Destroys every connection `rawCaller` opened. */
export function closeRawCallers(): void {
  for (const socket of sockets.splice(0)) {
    socket.destroy();
  }
}

/** A HEADERS frame of a POST to `path` with a JSON body, its END_STREAM unset, and `headers` beside. */
export function postFrame(
  streamId: number,
  path: string,
  headers: Readonly<Record<string, string>> = {},
): Buffer {
  const fields = [
    [':method', 'POST'],
    [':scheme', 'http'],
    [':path', path],
    [':authority', 'localhost'],
    ['content-type', 'application/json'],
    ...Object.entries(headers),
  ];
  const block = Buffer.concat(fields.map(([name = '', value = '']) => literalOf(name, value)));
  return frameOf({ type: 1, flags: 4, streamId }, block);
}

/** A DATA frame holding `text`, its END_STREAM unset. */
export function dataFrame(streamId: number, text: string): Buffer {
  return frameOf({ type: 0, flags: 0, streamId }, Buffer.from(text));
}

/** An RST_STREAM frame with `code`. */
export function resetFrame(streamId: number, code: number): Buffer {
  const payload = Buffer.alloc(4);
  payload.writeUInt32BE(code);
  return frameOf({ type: 3, flags: 0, streamId }, payload);
}

/** A WINDOW_UPDATE frame opening `bytes` more, on a stream or, with stream 0, the connection. */
export function windowFrame(streamId: number, bytes: number): Buffer {
  const payload = Buffer.alloc(4);
  payload.writeUInt32BE(bytes);
  return frameOf({ type: 8, flags: 0, streamId }, payload);
}

/** A frame's head fields: its type, its flags and its stream. */
type Head = { readonly type: number; readonly flags: number; readonly streamId: number };

function frameOf({ type, flags, streamId }: Head, payload: Buffer = Buffer.alloc(0)): Buffer {
  const head = Buffer.alloc(9);
  head.writeUIntBE(payload.length, 0, 3);
  head[3] = type;
  head[4] = flags;
  head.writeUInt32BE(streamId, 5);
  return Buffer.concat([head, payload]);
}

function settingsOf(window: number | undefined): Buffer {
  if (window === undefined) {
    return Buffer.alloc(0);
  }
  const payload = Buffer.alloc(6);
  payload.writeUInt16BE(4, 0);
  payload.writeUInt32BE(window, 2);
  return payload;
}

/** An HPACK literal field without indexing, with a new name, both under 128 bytes. */
function literalOf(name: string, value: string): Buffer {
  const nameBytes = Buffer.from(name);
  const valueBytes = Buffer.from(value);
  return Buffer.concat([
    Buffer.from([0, nameBytes.length]),
    nameBytes,
    Buffer.from([valueBytes.length]),
    valueBytes,
  ]);
}
