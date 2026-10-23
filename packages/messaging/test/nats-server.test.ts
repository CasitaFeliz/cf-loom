import { stat } from 'node:fs/promises';
import { connect } from 'node:net';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { aNatsServer } from './nats-server.ts';

function isListening(url: string): Promise<boolean> {
  const { hostname, port } = new URL(url);
  return new Promise((resolve) => {
    const socket = connect({ host: hostname, port: Number(port) });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
}

describe('a test NATS server', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test('starting one without nats-server on PATH fails naming nats-server and where its pinned release is', async () => {
    vi.stubEnv('PATH', '');

    const starting = aNatsServer();

    await expect(starting).rejects.toThrow(
      'nats-server is not on PATH: install the release pinned in .github/workflows/ci.yml (see CLAUDE.md)',
    );
  });

  test('a stopped server leaves its temporary directory removed and its port closed', async () => {
    const server = await aNatsServer();
    const listeningBefore = await isListening(server.url);
    const directoryBefore = await stat(server.directory);

    await server.stop();

    expect(listeningBefore).toBe(true);
    expect(directoryBefore.isDirectory()).toBe(true);
    await expect(isListening(server.url)).resolves.toBe(false);
    await expect(stat(server.directory)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
