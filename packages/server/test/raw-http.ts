import { connect } from 'node:net';

/** Sends raw HTTP/1.1 text to the server at `url`, and what came back, once the server closes. */
export async function raw(url: string, text: string): Promise<string> {
  const { port } = new URL(url);
  return await new Promise<string>((resolve) => {
    const socket = connect(Number(port), '127.0.0.1');
    let received = '';
    socket.on('data', (chunk) => {
      received += chunk.toString('latin1');
    });
    socket.on('error', () => undefined);
    socket.on('close', () => resolve(received));
    socket.write(text);
  });
}

/**
 * Sends raw HTTP/1.1 text and waits at most `ms` for the server to close the socket: what came
 * back, and whether it closed in time.
 */
export async function rawFor(url: string, text: string, ms: number) {
  const { port } = new URL(url);
  return await new Promise<{ readonly received: string; readonly closed: boolean }>((resolve) => {
    const socket = connect(Number(port), '127.0.0.1');
    let received = '';
    const timer = setTimeout(() => {
      socket.destroy();
      resolve({ received, closed: false });
    }, ms);
    socket.on('data', (chunk) => {
      received += chunk.toString('latin1');
    });
    socket.on('error', () => undefined);
    socket.on('close', () => {
      clearTimeout(timer);
      resolve({ received, closed: true });
    });
    socket.write(text);
  });
}

/** Every status line in a raw answer, one for each response of a pipelined connection. */
export function statusLinesOf(received: string): string[] {
  return received.match(/HTTP\/1\.1 \d+ [^\r\n]+/g) ?? [];
}

/** The first status line of a raw answer. */
export function statusLineOf(received: string): string {
  return received.split('\r\n')[0] ?? '';
}

/** The body of a raw response, its chunks joined when it was sent chunked. */
export function bodyOf(received: string): string {
  const [head = '', ...rest] = received.split('\r\n\r\n');
  let remaining = rest.join('\r\n\r\n');
  if (!/transfer-encoding: chunked/i.test(head)) {
    return remaining;
  }
  const chunks: string[] = [];
  for (let size = Number.parseInt(remaining, 16); size > 0; ) {
    const start = remaining.indexOf('\r\n') + 2;
    chunks.push(remaining.slice(start, start + size));
    remaining = remaining.slice(start + size + 2);
    size = Number.parseInt(remaining, 16);
  }
  return chunks.join('');
}
