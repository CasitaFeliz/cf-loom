import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startProcess, stopProcess, untilListening } from './test-process.ts';

const notOnPath =
  'nats-server is not on PATH: install the release pinned in .github/workflows/ci.yml (see CLAUDE.md)';

/** A nats-server a test started on a random local port, with a temporary store. */
export type NatsServer = {
  readonly url: string;
  /** The temporary directory holding its store and ports file, which `stop` removes. */
  readonly directory: string;
  readonly stop: () => Promise<void>;
};

/** Starts `nats-server -p -1 -a 127.0.0.1 -js` from PATH, reading its port from the ports file; never a fixed port or the user's own NATS. */
export async function aNatsServer(): Promise<NatsServer> {
  const directory = await mkdtemp(join(tmpdir(), 'cf-loom-nats-'));
  const removeStore = () => rm(directory, { recursive: true, force: true });
  const options = ['-p', '-1', '-a', '127.0.0.1', '-js', '-sd', directory];
  const server = startProcess('nats-server', [...options, '--ports_file_dir', directory], {
    notOnPath,
    cleanup: removeStore,
  });
  const url = await untilListening(server, 'nats-server', () => portsFileUrlOf(directory));
  const stop = async (): Promise<void> => {
    await stopProcess(server);
    await removeStore();
  };
  return { url, directory, stop };
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
