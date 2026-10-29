// biome-ignore-all lint/style/useNamingConvention: SQS names its headers, actions and fields in PascalCase, as they travel
import { connect } from 'node:net';
import { networkInterfaces } from 'node:os';
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

  async function aStartedServer(): Promise<MotoServer> {
    const server = await aMotoServer();
    started.push(server);
    return server;
  }

  afterEach(async () => {
    vi.unstubAllEnvs();
    await Promise.all(started.splice(0).map((server) => server.stop()));
  });

  test('starting one without moto_server on PATH fails naming moto_server and where its pinned requirements are', async () => {
    vi.stubEnv('PATH', '');

    const starting = aMotoServer();

    await expect(starting).rejects.toThrow(
      'moto_server is not on PATH: install moto from packages/messaging/test/moto-requirements.txt (see CLAUDE.md)',
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

  test('a stopped server leaves its port closed', async () => {
    const server = await aMotoServer();
    const listeningBefore = await isListening(server.url);

    await server.stop();

    expect(listeningBefore).toBe(true);
    await expect(isListening(server.url)).resolves.toBe(false);
  });
});
