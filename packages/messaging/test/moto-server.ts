import { startProcess, stopProcess, untilListening } from './test-process.ts';

const notOnPath =
  'moto_server is not on PATH: install moto from packages/messaging/test/moto-requirements.txt (see CLAUDE.md)';
const listeningLine = /^ \* Running on (http:\/\/127\.0\.0\.1:\d+)\n/m;

/** A moto server a test started on a random local port, holding SNS and SQS in memory. */
export type MotoServer = {
  /** `http://127.0.0.1:<port>`, the endpoint a test gives its SNS and SQS clients. */
  readonly url: string;
  /** Empties every topic, queue and subscription, so the next test starts from nothing. */
  readonly reset: () => Promise<void>;
  readonly stop: () => Promise<void>;
};

/** Starts `moto_server -H 127.0.0.1 -p 0` from PATH, reading its port from the line it prints on stderr; never a fixed port or another emulator. */
export async function aMotoServer(): Promise<MotoServer> {
  const server = startProcess('moto_server', ['-H', '127.0.0.1', '-p', '0'], notOnPath);
  const url = await untilListening(
    server,
    'moto_server',
    () => listeningLine.exec(server.stderr())?.[1],
  );
  return { url, reset: () => reset(url), stop: () => stopProcess(server) };
}

async function reset(url: string): Promise<void> {
  const response = await fetch(`${url}/moto-api/reset`, { method: 'POST' });
  if (!response.ok) {
    throw new Error(`moto_server did not reset: ${response.status} ${await response.text()}`);
  }
}
