import { isJsonContentType } from './content-type.ts';
import type { InputIssue } from './invalid-input.ts';

/**
 * A body as read: the parsed JSON, why it is no JSON, a stream that failed while it was read, with
 * the same Issue for a request and its error for a Caller, or too large to read.
 */
export type Body =
  | { readonly kind: 'value'; readonly value: unknown }
  | { readonly kind: 'malformed'; readonly issue: InputIssue }
  | { readonly kind: 'unreadable'; readonly issue: InputIssue; readonly error: unknown }
  | { readonly kind: 'too-large' };

/** What a body travels in, a request or a response: its headers and its stream. */
export type BodyMessage = {
  readonly headers: Headers;
  readonly body: ReadableStream<Uint8Array> | null;
};

/** What a body that was not JSON says, never what was received. */
const notJsonMessage = 'The body is not JSON';

const notJson = malformedOf(notJsonMessage);

/** What a body sent with another content type, or none, says. */
const notJsonContentType = malformedOf('The content type is not application/json');

/** A body that cannot be read as JSON: an Issue at the whole of `input.body`. */
function malformedOf(message: string): Body {
  return { kind: 'malformed', issue: malformedIssueOf(message) };
}

function malformedIssueOf(message: string): InputIssue {
  return { part: 'input.body', path: [], code: 'malformed', message };
}

/** The bytes of a body as read, counting them against the limit, or why they were not. */
type Bytes =
  | { readonly kind: 'bytes'; readonly bytes: Uint8Array }
  | { readonly kind: 'too-large' }
  | { readonly kind: 'unreadable'; readonly error: unknown };

/**
 * A request's or a response's JSON body: its content type first, then its bytes, counted as read
 * against `maxBodyBytes` whatever `Content-Length` says, then UTF-8 JSON; an empty body is no JSON.
 */
export async function bodyOf(
  message: BodyMessage,
  maxBodyBytes: number | undefined,
): Promise<Body> {
  if (!isJsonContentType(message.headers.get('content-type'))) {
    return notJsonContentType;
  }
  const read = await bytesOf(message.body, maxBodyBytes ?? Number.POSITIVE_INFINITY);
  switch (read.kind) {
    case 'too-large':
      return read;
    case 'unreadable':
      return { kind: 'unreadable', issue: malformedIssueOf(notJsonMessage), error: read.error };
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

function parsedOf(bytes: Uint8Array): Body {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return { kind: 'value', value: JSON.parse(text) };
  } catch {
    return notJson;
  }
}
