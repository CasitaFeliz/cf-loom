import { type ChildProcess, spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

/**
 * How long a server may take to listen. It is below Vitest's default 5 s test timeout and 10 s `beforeAll` timeout, so
 * a server that never listens fails its start, and is stopped, before either fires and leaves the process behind.
 */
const startDeadlineMs = 4_000;
const stopTimeoutMs = 5_000;
const pollIntervalMs = 20;
const stderrKept = 4_096;

/** A server a test spawned: it settles when the process has exited or could not start, and keeps the end of its stderr. */
export type TestProcess = {
  readonly child: ChildProcess;
  readonly exited: Promise<void>;
  readonly stderr: () => string;
};

/** Spawns `command` from PATH with only its stderr piped; a `command` that is not on PATH rejects `exited` with `notOnPath` as the message. */
export function startProcess(
  command: string,
  args: readonly string[],
  notOnPath: string,
): TestProcess {
  const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr = (stderr + chunk.toString()).slice(-stderrKept);
  });
  const exited = new Promise<void>((resolve, reject) => {
    child.once('close', () => resolve());
    child.once('error', (error: NodeJS.ErrnoException) => {
      reject(error.code === 'ENOENT' ? new Error(notOnPath) : error);
    });
  });
  exited.catch(() => undefined);
  return { child, exited, stderr: () => stderr };
}

/**
 * Polls `listening` until it gives what a listening server reports, such as its URL. When the process exits first or
 * does not listen within the deadline, it stops the process and fails naming `name` and the end of its stderr.
 */
export async function untilListening<T>(
  server: TestProcess,
  name: string,
  listening: () => T | undefined | Promise<T | undefined>,
): Promise<T> {
  try {
    return await poll(server, name, listening);
  } catch (error) {
    await stopProcess(server);
    throw error;
  }
}

async function poll<T>(
  server: TestProcess,
  name: string,
  listening: () => T | undefined | Promise<T | undefined>,
): Promise<T> {
  const deadline = Date.now() + startDeadlineMs;
  while (Date.now() < deadline) {
    const reported = await listening();
    if (reported !== undefined) {
      return reported;
    }
    const exit = await Promise.race([server.exited.then(() => 'exited'), sleep(pollIntervalMs)]);
    if (exit === 'exited') {
      throw new Error(`${name} exited before it listened: ${server.stderr()}`);
    }
  }
  throw new Error(`${name} did not listen within ${startDeadlineMs} ms: ${server.stderr()}`);
}

/** Asks the process to stop and kills it when it has not within the timeout; settles once it has exited. */
export async function stopProcess(server: TestProcess): Promise<void> {
  server.child.kill('SIGTERM');
  const killer = setTimeout(() => server.child.kill('SIGKILL'), stopTimeoutMs);
  await server.exited.catch(() => undefined);
  clearTimeout(killer);
}
