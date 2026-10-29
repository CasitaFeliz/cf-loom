import { type ChildProcess, spawn } from 'node:child_process';

const stderrKept = 4_096;

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
  await server.exited;
  throw new Error(`moto_server exited before it listened: ${server.stderr()}`);
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
