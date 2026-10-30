// biome-ignore-all lint/style/useNamingConvention: SQS names its headers, actions and fields in PascalCase, as they travel
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { connect } from 'node:net';
import { networkInterfaces, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { aMotoServer, type MotoServer } from './moto-server.ts';

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

/** An SQS call over its JSON protocol; the credential scope naming `sqs` is how moto routes it, and its signature is not checked. */
function sqs(server: MotoServer, action: string, body: object = {}): Promise<Response> {
  return fetch(server.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-amz-json-1.0',
      'X-Amz-Target': `AmazonSQS.${action}`,
      Authorization:
        'AWS4-HMAC-SHA256 Credential=test/20260101/us-east-1/sqs/aws4_request, SignedHeaders=host, Signature=0',
    },
    body: JSON.stringify(body),
  });
}

/** The IPv4 addresses of the host's network interfaces other than loopback; none on a host without a network. */
const externalAddresses = Object.values(networkInterfaces()).flatMap((addresses) =>
  (addresses ?? [])
    .filter((address) => address.family === 'IPv4' && !address.internal)
    .map((address) => address.address),
);

async function queueUrls(server: MotoServer): Promise<readonly string[]> {
  const listed = (await (await sqs(server, 'ListQueues')).json()) as {
    readonly QueueUrls?: readonly string[];
  };
  return listed.QueueUrls ?? [];
}

describe('a test moto server', () => {
  const started: MotoServer[] = [];
  const directories: string[] = [];

  /** Puts a `moto_server` that runs this Node script alone on PATH, to start a server that fails the way a real one may. */
  async function stubMotoServer(script: string): Promise<void> {
    const directory = await mkdtemp(join(tmpdir(), 'cf-loom-moto-stub-'));
    directories.push(directory);
    const executable = join(directory, 'moto_server');
    await writeFile(executable, `#!${process.execPath}\n${script}`);
    await chmod(executable, 0o755);
    vi.stubEnv('PATH', directory);
  }

  async function aStartedServer(): Promise<MotoServer> {
    const server = await aMotoServer();
    started.push(server);
    return server;
  }

  afterEach(async () => {
    vi.unstubAllEnvs();
    await Promise.all(started.splice(0).map((server) => server.stop()));
    await Promise.all(
      directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  test('starting one without moto_server on PATH fails naming moto_server and where its pinned requirements are', async () => {
    vi.stubEnv('PATH', '');

    const starting = aMotoServer();

    await expect(starting).rejects.toThrow(
      'moto_server is not on PATH: install moto from packages/messaging/test/moto-requirements.txt (see CLAUDE.md)',
    );
  });

  test('a server that exits before it listens fails the start naming what it wrote on stderr', async () => {
    await stubMotoServer("process.stderr.write('cannot bind the port\\n'); process.exit(3);");

    const starting = aMotoServer();

    await expect(starting).rejects.toThrow(
      'moto_server exited before it listened: cannot bind the port',
    );
  });

  test('a started server answers on the URL it reports, at 127.0.0.1', async () => {
    const server = await aStartedServer();

    const response = await sqs(server, 'ListQueues');

    expect(new URL(server.url).hostname).toBe('127.0.0.1');
    expect(response.status).toBe(200);
  });

  test.skipIf(externalAddresses.length === 0)(
    'a started server does not answer on the other IPv4 addresses of the host (skipped on a host with none)',
    async () => {
      const server = await aStartedServer();
      const { port } = new URL(server.url);

      const answers = await Promise.all(
        externalAddresses.map(async (address) => ({
          address,
          listening: await isListening(`http://${address}:${port}`),
        })),
      );

      await expect(isListening(server.url)).resolves.toBe(true);
      expect(answers.filter((answer) => answer.listening)).toEqual([]);
    },
  );

  test('reset empties the queues a test created', async () => {
    const server = await aStartedServer();
    await sqs(server, 'CreateQueue', { QueueName: 'orders' });
    const queuesBefore = await queueUrls(server);

    await server.reset();

    expect(queuesBefore).toHaveLength(1);
    await expect(queueUrls(server)).resolves.toEqual([]);
  });

  test('reset fails naming the answer when the server refuses it', async () => {
    await stubMotoServer(`
      const { createServer } = require('node:http');
      const server = createServer((request, response) => {
        response.statusCode = 500;
        response.end('state is stuck');
      });
      server.listen(0, '127.0.0.1', () => {
        process.stderr.write(\` * Running on http://127.0.0.1:\${server.address().port}\\n\`);
      });
    `);
    const server = await aStartedServer();

    const resetting = server.reset();

    await expect(resetting).rejects.toThrow('moto_server did not reset: 500 state is stuck');
  });

  test('a stopped server leaves its port closed', async () => {
    const server = await aMotoServer();
    const listeningBefore = await isListening(server.url);

    await server.stop();

    expect(listeningBefore).toBe(true);
    await expect(isListening(server.url)).resolves.toBe(false);
  });
});
