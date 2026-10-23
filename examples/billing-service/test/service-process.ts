import { type ChildProcessByStdio, spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { Readable } from 'node:stream';

const startTimeoutMs = 15_000;
const stopTimeoutMs = 10_000;
const stderrKept = 4_096;

/** How a process ended: its exit status, or the signal that killed it. */
export type Exit = {
  readonly status: number | null;
  readonly signal: NodeJS.Signals | null;
};

/** A Service's `main.ts` a test started as a process of its own. */
export type ServiceProcess = {
  /** The port the Service printed that it listens on. */
  readonly port: number;
  /** The end of what the process wrote to stderr, kept in a bounded buffer. */
  readonly stderr: () => string;
  /** Sends SIGTERM and resolves with how the process exited, after SIGKILL if it takes more than 10 s; calling it again returns the same promise. */
  readonly stop: () => Promise<Exit>;
};

type Started = {
  readonly child: ChildProcessByStdio<null, Readable, Readable>;
  readonly exited: Promise<Exit>;
};

/**
 * Starts `node src/main.ts` in the Service's directory with exactly `env` and nothing inherited, so
 * no NATS_URL reaches it but the test server's; it resolves once the Service prints the port it
 * listens on, and otherwise kills it and rejects with what it wrote to stderr.
 */
export async function aServiceProcess(
  serviceDir: string,
  env: Readonly<Record<string, string>>,
): Promise<ServiceProcess> {
  const child = spawn(process.execPath, ['src/main.ts'], {
    cwd: serviceDir,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const exited = exitOf(child);
  const stderr = endOf(child.stderr);
  const port = await listeningPort({ child, exited }, stderr);
  let stopping: Promise<Exit> | undefined;
  return {
    port,
    stderr,
    stop: () => {
      stopping ??= terminate({ child, exited });
      return stopping;
    },
  };
}

function exitOf(child: ChildProcessByStdio<null, Readable, Readable>): Promise<Exit> {
  const exited = new Promise<Exit>((resolve, reject) => {
    child.once('close', (status, signal) => resolve({ signal, status }));
    child.once('error', reject);
  });
  exited.catch(() => undefined);
  return exited;
}

/** The last bytes the stream wrote, kept as it writes. */
function endOf(stream: Readable): () => string {
  let kept = '';
  stream.on('data', (chunk: Buffer) => {
    kept = (kept + chunk.toString()).slice(-stderrKept);
  });
  return () => kept;
}

function portPrinted(stdout: Readable): Promise<number> {
  return new Promise((resolve) => {
    createInterface({ input: stdout }).on('line', (line) => {
      const port = /listening on (\d+)$/.exec(line)?.[1];
      if (port !== undefined) {
        resolve(Number(port));
      }
    });
  });
}

async function listeningPort(started: Started, stderr: () => string): Promise<number> {
  let timer: NodeJS.Timeout | undefined;
  const timedOut = new Promise<'timed out'>((resolve) => {
    timer = setTimeout(() => resolve('timed out'), startTimeoutMs);
  });
  try {
    const winner = await Promise.race([
      portPrinted(started.child.stdout),
      started.exited,
      timedOut,
    ]);
    if (typeof winner === 'number') {
      return winner;
    }
    started.child.kill('SIGKILL');
    const why = winner === 'timed out' ? `did not listen within ${startTimeoutMs} ms` : 'exited';
    throw new Error(`The Service ${why} before it listened: ${stderr()}`);
  } finally {
    clearTimeout(timer);
  }
}

async function terminate({ child, exited }: Started): Promise<Exit> {
  child.kill('SIGTERM');
  const killer = setTimeout(() => child.kill('SIGKILL'), stopTimeoutMs);
  try {
    return await exited;
  } finally {
    clearTimeout(killer);
  }
}
