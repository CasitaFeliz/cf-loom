import { type ChildProcess, spawn } from 'node:child_process';
import type { Readable } from 'node:stream';
import { setTimeout as sleep } from 'node:timers/promises';
import { aroundEach } from 'vitest';

const pollIntervalMs = 20;
const outputKept = 4_096;

/** How a process ended: its exit status, or the signal that ended it. */
export type Exit = {
  readonly status: number | null;
  readonly signal: NodeJS.Signals | null;
};

/**
 * A process a test spawned. It is owned from its spawn: what is still running when the test that spawned it ends is
 * killed then. It keeps the end of its stdout and stderr.
 */
export type TestProcess = {
  readonly child: ChildProcess;
  readonly exited: Promise<Exit>;
  readonly stdout: () => string;
  readonly stderr: () => string;
};

/** Where and how to spawn: `env` replaces the environment when given; `notOnPath` is the message when `command` is not on PATH. */
export type Spawning = {
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly notOnPath?: string;
};

const owners: Set<TestProcess>[] = [];
const waiting = new Map<TestProcess, string>();

/** Spawns `command` with stdout and stderr piped, owned by the running test. */
export function startProcess(
  command: string,
  args: readonly string[],
  spawning: Spawning = {},
): TestProcess {
  const { cwd, env, notOnPath } = spawning;
  const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = new Promise<Exit>((resolve, reject) => {
    child.once('close', (status, signal) => resolve({ status, signal }));
    child.once('error', (error: NodeJS.ErrnoException) => {
      const missing = error.code === 'ENOENT' && notOnPath !== undefined;
      reject(missing ? new Error(notOnPath) : error);
    });
  });
  exited.catch(() => undefined);
  const server = { child, exited, stdout: tailOf(child.stdout), stderr: tailOf(child.stderr) };
  owners.at(-1)?.add(server);
  return server;
}

function tailOf(stream: Readable | null): () => string {
  let kept = '';
  stream?.on('data', (chunk: Buffer) => {
    kept = (kept + chunk.toString()).slice(-outputKept);
  });
  return () => kept;
}

/**
 * Polls `listening` until it gives what a listening server reports, such as its URL. It fails at once, naming `name`
 * and the end of the server's stderr, when the server exits first. It has no deadline of its own: the test's or
 * hook's timeout bounds it, and the owner then kills the server and writes its stderr to the test's output.
 */
export async function untilListening<T>(
  server: TestProcess,
  name: string,
  listening: () => T | undefined | Promise<T | undefined>,
): Promise<T> {
  waiting.set(server, name);
  try {
    for (;;) {
      const reported = await listening();
      if (reported !== undefined) {
        return reported;
      }
      const exit = await Promise.race([server.exited.then(() => 'exited'), sleep(pollIntervalMs)]);
      if (exit === 'exited') {
        throw new Error(`${name} exited before it listened: ${server.stderr()}`);
      }
    }
  } finally {
    waiting.delete(server);
  }
}

/** Sends SIGTERM and settles with how the process exited; a process that ignores it is killed when its owner ends. */
export function stopProcess(server: TestProcess): Promise<Exit> {
  server.child.kill('SIGTERM');
  return server.exited;
}

/**
 * Runs a test as the owner of what it spawns, then kills what is still running and writes to stderr the name and
 * stderr of each process still waiting to listen. The tests it owns run one at a time.
 */
async function ownProcesses(run: () => Promise<void>): Promise<void> {
  const owned = new Set<TestProcess>();
  owners.push(owned);
  try {
    await run();
  } finally {
    owners.splice(owners.indexOf(owned), 1);
    await release(owned);
  }
}

async function release(owned: ReadonlySet<TestProcess>): Promise<void> {
  for (const server of owned) {
    const name = waiting.get(server);
    if (name !== undefined) {
      console.error(`${name} was still waiting to listen when its owner ended: ${server.stderr()}`);
    }
    server.child.kill('SIGKILL');
  }
  await Promise.all([...owned].map((server) => server.exited.catch(() => undefined)));
}

aroundEach((runTest) => ownProcesses(runTest));
