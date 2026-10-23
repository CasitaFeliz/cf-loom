import { type ChildProcess, spawn } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const startTimeoutMs = 10_000;
const stopTimeoutMs = 5_000;
const pollIntervalMs = 20;
const stderrKept = 4_096;

/** A nats-server a test started on a random local port, with a temporary store. */
export type NatsServer = {
  readonly url: string;
  /** The temporary directory holding its store and ports file, which `stop` removes. */
  readonly directory: string;
  readonly stop: () => Promise<void>;
};

/** A spawned nats-server: it settles when the process has exited or could not start, and keeps the end of its stderr. */
type Process = {
  readonly child: ChildProcess;
  readonly exited: Promise<void>;
  readonly stderr: () => string;
};

/** Starts `nats-server -p -1 -a 127.0.0.1 -js` from PATH, reading its port from the ports file; never a fixed port or the user's own NATS. */
export async function aNatsServer(): Promise<NatsServer> {
  const directory = await mkdtemp(join(tmpdir(), 'cf-loom-nats-'));
  const server = start(directory);
  try {
    const url = await urlOf(server, directory);
    return { url, directory, stop: () => stop(server, directory) };
  } catch (error) {
    await stop(server, directory);
    throw error;
  }
}

function start(directory: string): Process {
  const options = ['-p', '-1', '-a', '127.0.0.1', '-js', '-sd', directory];
  const child = spawn('nats-server', [...options, '--ports_file_dir', directory], {
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
    'nats-server is not on PATH: install the release pinned in .github/workflows/ci.yml (see CLAUDE.md)',
  );
}

/** The URL in the ports file the server writes once it listens, read as soon as it parses. */
async function urlOf(server: Process, directory: string): Promise<string> {
  const deadline = Date.now() + startTimeoutMs;
  while (Date.now() < deadline) {
    const url = await portsFileUrlOf(directory);
    if (url !== undefined) {
      return url;
    }
    const exit = await Promise.race([server.exited.then(() => 'exited'), sleep(pollIntervalMs)]);
    if (exit === 'exited') {
      throw new Error(`nats-server exited before it listened: ${server.stderr()}`);
    }
  }
  throw new Error(`nats-server did not listen within ${startTimeoutMs} ms: ${server.stderr()}`);
}

async function portsFileUrlOf(directory: string): Promise<string | undefined> {
  const names = await readdir(directory);
  const portsFile = names.find((name) => name.endsWith('.ports'));
  if (portsFile === undefined) {
    return undefined;
  }
  try {
    const ports: unknown = JSON.parse(await readFile(join(directory, portsFile), 'utf8'));
    return urlIn(ports);
  } catch {
    return undefined;
  }
}

function urlIn(ports: unknown): string | undefined {
  const nats = (ports as { readonly nats?: readonly unknown[] }).nats;
  const url = nats?.[0];
  return typeof url === 'string' ? url : undefined;
}

async function stop(server: Process, directory: string): Promise<void> {
  server.child.kill('SIGTERM');
  const killer = setTimeout(() => server.child.kill('SIGKILL'), stopTimeoutMs);
  await server.exited.catch(() => undefined);
  clearTimeout(killer);
  await rm(directory, { recursive: true, force: true });
}
