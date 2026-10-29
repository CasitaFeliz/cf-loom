import { type ChildProcess, spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const startTimeoutMs = 10_000;
const stopTimeoutMs = 5_000;
const pollIntervalMs = 20;
const stderrKept = 4_096;
const listeningLine = /^ \* Running on (http:\/\/127\.0\.0\.1:\d+)\n/m;

/** A moto server a test started on a random local port, holding SNS and SQS in memory. */
export type MotoServer = {
  /** `http://127.0.0.1:<port>`, the endpoint a test gives its SNS and SQS clients. */
  readonly url: string;
  /** Empties every topic, queue and subscription, so the next test starts from nothing. */
  readonly reset: () => Promise<void>;
  readonly stop: () => Promise<void>;
};

/** A spawned moto_server: it settles when the process has exited or could not start, and keeps the end of its stderr. */
type Process = {
  readonly child: ChildProcess;
  readonly exited: Promise<void>;
  readonly stderr: () => string;
};

/** Starts `moto_server -H 127.0.0.1 -p 0` from PATH, reading its port from the line it prints on stderr; never a fixed port or another emulator. */
export async function aMotoServer(): Promise<MotoServer> {
  const server = start();
  try {
    const url = await urlOf(server);
    return { url, reset: async () => undefined, stop: () => stop(server) };
  } catch (error) {
    await stop(server);
    throw error;
  }
}

function start(): Process {
  const child = spawn('moto_server', ['-H', '127.0.0.1', '-p', '0'], {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr = (stderr + chunk.toString()).slice(-stderrKept);
  });
  const exited = new Promise<void>((resolve, reject) => {
    child.once('close', () => resolve());
    child.once('error', (error: NodeJS.ErrnoException) => {
      reject(error.code === 'ENOENT' ? notOnPath() : error);
    });
  });
  exited.catch(() => undefined);
  return { child, exited, stderr: () => stderr };
}

function notOnPath(): Error {
  return new Error(
    'moto_server is not on PATH: install moto from packages/messaging/test/moto-requirements.txt (see CLAUDE.md)',
  );
}

/** The URL in the line the server prints once it listens, read as soon as the line is whole. */
async function urlOf(server: Process): Promise<string> {
  const deadline = Date.now() + startTimeoutMs;
  while (Date.now() < deadline) {
    const url = listeningLine.exec(server.stderr())?.[1];
    if (url !== undefined) {
      return url;
    }
    const exit = await Promise.race([server.exited.then(() => 'exited'), sleep(pollIntervalMs)]);
    if (exit === 'exited') {
      throw new Error(`moto_server exited before it listened: ${server.stderr()}`);
    }
  }
  throw new Error(`moto_server did not listen within ${startTimeoutMs} ms: ${server.stderr()}`);
}

async function stop(server: Process): Promise<void> {
  server.child.kill('SIGTERM');
  const killer = setTimeout(() => server.child.kill('SIGKILL'), stopTimeoutMs);
  await server.exited.catch(() => undefined);
  clearTimeout(killer);
}
