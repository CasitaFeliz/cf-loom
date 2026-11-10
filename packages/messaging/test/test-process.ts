import { type ChildProcess, spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { setTimeout as sleep } from 'node:timers/promises';
import { aroundAll, aroundEach } from 'vitest';

const pollIntervalMs = 20;
const outputKept = 4_096;

/** How a process ended: its exit status, or the signal that ended it. */
export type Exit = {
  readonly status: number | null;
  readonly signal: NodeJS.Signals | null;
};

/**
 * A process a test started, owned from its creation: when its owner ends, it is killed with SIGKILL if still running.
 * A killed process is assumed to have no children of its own, which SIGKILL would leave running. It keeps the end of
 * its stdout and stderr.
 */
export type TestProcess = {
  readonly child: ChildProcess;
  readonly exited: Promise<Exit>;
  readonly stdout: () => string;
  readonly stderr: () => string;
};

/**
 * Where and how to spawn: `env` replaces the environment when given, and leaves out a variable it gives as `undefined`;
 * `notOnPath` is the message when `command` is not on PATH.
 */
export type Spawning = {
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly notOnPath?: string;
};

/** How a run ended by its own exit: its exit status and everything it printed. */
export type Ran = {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
};

/** What a run is given besides `Spawning`: the text written to its stdin, which is then closed. */
export type Running = Spawning & { readonly input?: string };

const owners: AsyncDisposableStack[] = [];
/** What each process still short of its end is doing, as the owner writes it when it ends first. */
const unfinished = new Map<TestProcess, string>();

/**
 * The owner of what is created now: the running test, which also owns what its `beforeEach` and `afterEach` hooks
 * create, or the file while a `beforeAll` or `afterAll` hook runs. A fixture of file or worker scope is set up inside
 * the first test that uses it, so that test owns what it creates. It throws, naming `what`, when neither runs.
 */
function ownerOf(what: string): AsyncDisposableStack {
  const owner = owners.at(-1);
  if (owner === undefined) {
    throw new Error(
      `no test or hook owns ${what}: create it inside one, in a file that imports test-process.ts`,
    );
  }
  return owner;
}

/** Creates a directory in the system's temporary directory, its name `prefix` and a random suffix, removed when its owner ends. */
export function aTemporaryDirectory(prefix: string): string {
  const owner = ownerOf(`the temporary directory ${prefix}`);
  const directory = mkdtempSync(join(tmpdir(), prefix));
  owner.defer(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

/**
 * Spawns `command` with stdout and stderr piped. Its owner is the running test, also in its `beforeEach` and
 * `afterEach`, or the file in a `beforeAll` or `afterAll`; it throws when no test or hook runs.
 */
export function startProcess(
  command: string,
  args: readonly string[],
  spawning: Spawning = {},
): TestProcess {
  return ownedProcess(command, args, spawning);
}

/** Spawns as `startProcess` does, with stdin ignored, or a pipe that writes `input` and closes when `running` has one. */
function ownedProcess(command: string, args: readonly string[], running: Running): TestProcess {
  const owner = ownerOf(command);
  const { cwd, env, input, notOnPath } = running;
  const stdin = input === undefined ? 'ignore' : 'pipe';
  const child = spawn(command, args, { cwd, env, stdio: [stdin, 'pipe', 'pipe'] });
  child.stdin?.on('error', () => undefined);
  child.stdin?.end(input);
  child.stdout?.setEncoding('utf8');
  child.stderr?.setEncoding('utf8');
  const exited = new Promise<Exit>((resolve, reject) => {
    child.once('close', (status, signal) => resolve({ status, signal }));
    child.once('error', (error: NodeJS.ErrnoException) => {
      const missing = error.code === 'ENOENT' && notOnPath !== undefined;
      reject(missing ? new Error(notOnPath) : error);
    });
  });
  exited.catch(() => undefined);
  const server = { child, exited, stdout: tailOf(child.stdout), stderr: tailOf(child.stderr) };
  owner.defer(() => kill(server));
  return server;
}

function tailOf(stream: Readable | null): () => string {
  let kept = '';
  stream?.on('data', (chunk: string) => {
    kept = (kept + chunk).slice(-outputKept);
  });
  return () => kept;
}

/** Kills `server` and awaits its exit, first writing to stderr what it was still doing and its stderr when it has not finished. */
async function kill(server: TestProcess): Promise<void> {
  const doing = unfinished.get(server);
  if (doing !== undefined) {
    console.error(`${doing} when its owner ended: ${server.stderr()}`);
  }
  server.child.kill('SIGKILL');
  await server.exited.catch(() => undefined);
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
  unfinished.set(server, `${name} was still waiting to listen`);
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
    unfinished.delete(server);
  }
}

/**
 * Runs `command` to its exit, owned as `startProcess`'s processes are, and gives its exit status and all it printed.
 * It rejects, naming the command line, when a signal ended it, with the end of its stderr, or when it cannot start.
 * It has no deadline of its own: the test's or hook's timeout bounds it, and the owner then kills it and writes its
 * stderr to the output.
 */
export async function runProcess(
  command: string,
  args: readonly string[],
  running: Running = {},
): Promise<Ran> {
  const commandLine = commandLineOf(command, args);
  const server = ownedProcess(command, args, running);
  const stdout = chunksOf(server.child.stdout);
  const stderr = chunksOf(server.child.stderr);
  unfinished.set(server, `${commandLine} was still running`);
  try {
    const { status, signal } = await server.exited;
    if (status === null) {
      throw new Error(`${commandLine} was ended by ${signal}: ${server.stderr()}`);
    }
    return { status, stdout: stdout(), stderr: stderr() };
  } finally {
    unfinished.delete(server);
  }
}

function commandLineOf(command: string, args: readonly string[]): string {
  return [command, ...args].join(' ');
}

/**
 * Runs `command` as `runProcess` does, for the stdout it prints when it exits with status 0; it rejects, naming the
 * command line, the status and its stderr, when it exits with another.
 */
export async function runForOutput(
  command: string,
  args: readonly string[],
  running: Running = {},
): Promise<string> {
  const ran = await runProcess(command, args, running);
  if (ran.status !== 0) {
    const commandLine = commandLineOf(command, args);
    throw new Error(`${commandLine} ended with status ${ran.status}: ${ran.stderr}`);
  }
  return ran.stdout;
}

/** Collects `stream`, which decodes its chunks as UTF-8 across their edges, whole. */
function chunksOf(stream: Readable | null): () => string {
  const chunks: string[] = [];
  stream?.on('data', (chunk: string) => chunks.push(chunk));
  return () => chunks.join('');
}

/** Sends SIGTERM and settles with how the process exited; a process that ignores it is killed when its owner ends. */
export function stopProcess(server: TestProcess): Promise<Exit> {
  server.child.kill('SIGTERM');
  return server.exited;
}

/**
 * Runs a test or a file as the owner of what is created meanwhile, then ends it all, in reverse order of creation.
 * The tests it owns run one at a time.
 */
async function owning(run: () => Promise<void>): Promise<void> {
  const owner = new AsyncDisposableStack();
  owners.push(owner);
  try {
    await run();
  } finally {
    owners.splice(owners.indexOf(owner), 1);
    await owner.disposeAsync();
  }
}

aroundAll(owning);
aroundEach(owning);
