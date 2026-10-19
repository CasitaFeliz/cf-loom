import { isJsonContentType } from './content-type.ts';
import type { InputIssue } from './invalid-input.ts';

/**
 * A body a Caller received: its parsed JSON, why it is no JSON, or the error its stream failed
 * with; each failure says it in a fixed text that carries nothing received.
 */
export type ReceivedBody =
  | { readonly kind: 'value'; readonly value: unknown }
  | { readonly kind: 'malformed'; readonly message: string }
  | { readonly kind: 'unreadable'; readonly message: string; readonly error: unknown };

/** A body as `serve` reads it: as a Caller receives one, or too large to read. */
export type Body = ReceivedBody | { readonly kind: 'too-large' };

/** What a body travels in, a request or a response: its headers and its stream. */
export type BodyMessage = {
  readonly headers: Headers;
  readonly body: ReadableStream<Uint8Array> | null;
};

/** What a body that was not JSON, or whose stream failed, says, never what was received. */
const notJsonMessage = 'The body is not JSON';

const notJsonContentType = {
  kind: 'malformed',
  message: 'The content type is not application/json',
} as const;

/** The Issue `serve` answers for a body that cannot be read as JSON: at the whole of `input.body`. */
export function malformedBodyIssueOf(message: string): InputIssue {
  return { part: 'input.body', path: [], code: 'malformed', message };
}

/** The Issue of a request that carries no JSON body where one is declared. */
export const notJsonBodyIssue = malformedBodyIssueOf(notJsonMessage);

/** The bytes of a body as read, counting them against the limit, or why they were not. */
type Bytes =
  | { readonly kind: 'bytes'; readonly bytes: Uint8Array }
  | { readonly kind: 'too-large' }
  | { readonly kind: 'unreadable'; readonly error: unknown };

/**
 * A request's JSON body: its content type first, then its bytes, counted as read against
 * `maxBodyBytes` whatever `Content-Length` says, then UTF-8 JSON; an empty body is no JSON.
 */
export async function bodyOf(
  message: BodyMessage,
  maxBodyBytes: number | undefined,
): Promise<Body> {
  if (!isJsonContentType(message.headers.get('content-type'))) {
    return notJsonContentType;
  }
  return await jsonOf(message.body, maxBodyBytes ?? Number.POSITIVE_INFINITY);
}

/**
 * A response's JSON body, read whole by the same reader with no limit. A body that is not JSON by
 * its content type is discarded unread.
 */
export async function receivedBodyOf(message: BodyMessage): Promise<ReceivedBody> {
  if (!isJsonContentType(message.headers.get('content-type'))) {
    await discardBodyOf(message);
    return notJsonContentType;
  }
  const body = await jsonOf(message.body, Number.POSITIVE_INFINITY);
  if (body.kind === 'too-large') {
    throw new Error('A body read with no limit is never too large');
  }
  return body;
}

/** A body left unread, its stream cancelled; one that already failed is past cancelling. */
export async function discardBodyOf(message: BodyMessage): Promise<void> {
  try {
    await message.body?.cancel();
  } catch {
    return;
  }
}

/** A stream's bytes as UTF-8 JSON, within the limit. */
async function jsonOf(
  stream: ReadableStream<Uint8Array> | null,
  maxBodyBytes: number,
): Promise<Body> {
  const read = await bytesOf(stream, maxBodyBytes);
  switch (read.kind) {
    case 'too-large':
      return read;
    case 'unreadable':
      return { kind: 'unreadable', message: notJsonMessage, error: read.error };
    case 'bytes':
      return parsedOf(read.bytes);
  }
}

async function bytesOf(
  stream: ReadableStream<Uint8Array> | null,
  maxBodyBytes: number,
): Promise<Bytes> {
  if (stream === null) {
    return { kind: 'bytes', bytes: new Uint8Array() };
  }
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (let read = await reader.read(); !read.done; read = await reader.read()) {
      length += read.value.byteLength;
      if (length > maxBodyBytes) {
        await reader.cancel();
        return { kind: 'too-large' };
      }
      chunks.push(read.value);
    }
  } catch (e) {
    return { kind: 'unreadable', error: e };
  }
  return { kind: 'bytes', bytes: joined(chunks, length) };
}

function joined(chunks: readonly Uint8Array[], length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function parsedOf(bytes: Uint8Array): ReceivedBody {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return { kind: 'value', value: JSON.parse(text) };
  } catch {
    return { kind: 'malformed', message: notJsonMessage };
  }
}
