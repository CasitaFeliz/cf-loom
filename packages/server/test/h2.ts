import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import {
  type ClientHttp2Session,
  type ClientHttp2Stream,
  connect,
  type IncomingHttpHeaders,
  type OutgoingHttpHeaders,
  type SecureServerOptions,
} from 'node:http2';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** What came back on one HTTP/2 stream once it closed. */
export type H2Answer = {
  readonly status: number | undefined;
  readonly headers: IncomingHttpHeaders;
  readonly body: string;
  /** The code the stream closed with: 0 is `NO_ERROR`. */
  readonly rstCode: number | undefined;
  /** Whether the response arrived whole, its end received. */
  readonly ended: boolean;
  /** How many bytes of the request's body were written before the stream closed. */
  readonly sent: number;
};

/** A key and a self-signed certificate for `localhost`, made by `openssl` for one test run. */
export type Tls = { readonly key: Buffer; readonly cert: Buffer };

const sessions: ClientHttp2Session[] = [];

/** An HTTP/2 session to the server at `url`, which `closeSessions` destroys. */
export function h2Session(url: string, tls?: Tls): ClientHttp2Session {
  const session = connect(url, tls && { ca: tls.cert, servername: 'localhost' });
  session.on('error', () => undefined);
  sessions.push(session);
  return session;
}

/** Destroys every session `h2Session` opened, so no server waits on one. */
export function closeSessions(): void {
  for (const session of sessions.splice(0)) {
    session.destroy();
  }
}

/**
 * Sends one request on `session`, its body in chunks that honor `drain`, since one large write
 * overruns the client's own session memory, and what came back once the stream closed.
 */
export async function h2(
  session: ClientHttp2Session,
  headers: OutgoingHttpHeaders,
  body?: string,
): Promise<H2Answer> {
  const stream = session.request(headers, { endStream: body === undefined });
  const answer = answerOf(stream);
  const sent = body === undefined ? 0 : await bodySent(stream, Buffer.from(body));
  return { ...(await answer), sent };
}

/** What comes back on `stream` once it closes, but the bytes sent. */
export async function answerOf(stream: ClientHttp2Stream): Promise<Omit<H2Answer, 'sent'>> {
  stream.on('error', () => undefined);
  const chunks: Buffer[] = [];
  let headers: IncomingHttpHeaders = {};
  let ended = false;
  stream.on('response', (received) => {
    headers = received;
  });
  stream.on('data', (chunk: Buffer) => chunks.push(chunk));
  stream.on('end', () => {
    ended = true;
  });
  await new Promise((resolve) => stream.on('close', resolve));
  const status = headers[':status'] === undefined ? undefined : Number(headers[':status']);
  const body = Buffer.concat(chunks).toString();
  return { status, headers, body, rstCode: stream.rstCode, ended };
}

/**
 * Writes `body` until it is sent or the server closes the stream, then ends it, or destroys it
 * once the server closed it, so a write left waiting for `drain` never holds it open.
 */
async function bodySent(stream: ClientHttp2Stream, body: Buffer): Promise<number> {
  const size = 16_384;
  let sent = 0;
  for (; sent < body.length && !stream.closed; sent += size) {
    if (!stream.write(body.subarray(sent, sent + size)) && !stream.closed) {
      await new Promise((resolve) => {
        stream.once('drain', resolve);
        stream.once('aborted', resolve);
        stream.once('close', resolve);
      });
    }
  }
  if (stream.closed) {
    stream.destroy();
  } else {
    stream.end();
  }
  return Math.min(sent, body.length);
}

/** A key and certificate made by `openssl` on `PATH`, valid one day, so none is committed. */
export function selfSigned(): Tls {
  const directory = mkdtempSync(join(tmpdir(), 'cf-loom-tls-'));
  try {
    const keyFile = join(directory, 'key.pem');
    const certFile = join(directory, 'cert.pem');
    execFileSync(
      'openssl',
      [
        ...['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1'],
        ...['-nodes', '-days', '1', '-subj', '/CN=localhost'],
        ...['-keyout', keyFile, '-out', certFile],
      ],
      { stdio: 'ignore' },
    );
    return { key: readFileSync(keyFile), cert: readFileSync(certFile) };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

/** The TLS options of a server that serves HTTP/1.1 beside HTTP/2 with `tls`. */
export function allowingHttp1(tls: Tls): SecureServerOptions {
  // biome-ignore lint/style/useNamingConvention: Node's option, spelled as Node spells it
  return { allowHTTP1: true, key: tls.key, cert: tls.cert };
}
