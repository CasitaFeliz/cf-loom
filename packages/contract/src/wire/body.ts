import { isJsonContentType } from './headers.ts';

/** A request's body as read: the parsed JSON, why it cannot be read as JSON, or too large to read. */
export type Body =
  | { readonly kind: 'value'; readonly value: unknown }
  | { readonly kind: 'malformed'; readonly message: string }
  | { readonly kind: 'too-large' };

/** What a body that was not JSON says, never what was received. */
const notJson: Body = { kind: 'malformed', message: 'The body is not JSON' };

/** What a body sent with another content type, or none, says. */
const notJsonContentType: Body = {
  kind: 'malformed',
  message: 'The content type is not application/json',
};

/** The bytes of a body as read, counting them against the limit, or why they were not. */
type Bytes =
  | { readonly kind: 'bytes'; readonly bytes: Uint8Array }
  | { readonly kind: 'too-large' }
  | { readonly kind: 'unreadable' };

/**
 * A request's JSON body: its content type first, then its bytes, counted as read against
 * `maxBodyBytes` whatever `Content-Length` says, then UTF-8 JSON; an empty body is no JSON.
 */
export async function bodyOf(request: Request, maxBodyBytes: number | undefined): Promise<Body> {
  if (!isJsonContentType(request.headers.get('content-type'))) {
    return notJsonContentType;
  }
  const read = await bytesOf(request.body, maxBodyBytes ?? Number.POSITIVE_INFINITY);
  switch (read.kind) {
    case 'too-large':
      return read;
    case 'unreadable':
      return notJson;
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
  } catch {
    return { kind: 'unreadable' };
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
