import { connect } from 'node:net';
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

  test('a stopped server leaves its port closed', async () => {
    const server = await aMotoServer();
    const listeningBefore = await isListening(server.url);

    await server.stop();

    expect(listeningBefore).toBe(true);
    await expect(isListening(server.url)).resolves.toBe(false);
  });
});
